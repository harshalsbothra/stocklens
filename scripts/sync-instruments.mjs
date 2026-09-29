import fs from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
const NSE_URL="https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const NSE_SME_URL="https://nsearchives.nseindia.com/content/equities/EQUITY_SME.csv";
const BSE_URL="https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w";
const headers={"User-Agent":"Mozilla/5.0 StockLens/1.0","Accept":"text/csv,application/json,text/plain,*/*","Referer":"https://www.nseindia.com/"};

function csv(text){
  const rows=[]; let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(c==='"'&&quoted&&n==='"'){cell+='"';i++;continue}
    if(c==='"'){quoted=!quoted;continue}
    if(c===","&&!quoted){row.push(cell.trim());cell="";continue}
    if((c==="\n"||c==="\r")&&!quoted){
      if(c==="\r"&&n==="\n")i++;
      row.push(cell.trim()); if(row.some(Boolean))rows.push(row);
      row=[];cell="";continue
    }
    cell+=c
  }
  if(cell||row.length){row.push(cell.trim());rows.push(row)}
  const head=(rows.shift()||[]).map(x=>x.toLowerCase().replace(/[^a-z0-9]/g,""));
  return rows.map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]??""])))
}

async function get(url,options={}){
  const r=await fetch(url,{...options,headers:{...headers,...(options.headers||{})}});
  if(!r.ok)throw new Error(url+" -> "+r.status);
  return r
}

function add(map,item){
  if(!item.symbol&&!item.bseCode)return;
  const key=item.isin||((item.exchanges||[])[0]+":"+item.symbol);
  const old=map.get(key);
  map.set(key,old?{...old,...item,symbol:old.symbol||item.symbol,name:old.name||item.name,isin:old.isin||item.isin,exchanges:[...new Set([...(old.exchanges||[]),...(item.exchanges||[])])]}:item)
}

async function main(){
  const out=new Map();
  for(const [url,assetType] of [[NSE_URL,"equity"],[NSE_SME_URL,"sme"]]){
    try{
      const rows=csv(await(await get(url)).text());
      for(const r of rows){
        const series=(r.series||"").toUpperCase();
        const symbol=(r.symbol||"").trim();
        const isin=(r.isinnumber||r.isin||"").trim();
        const name=(r.nameofcompany||r.name||symbol).trim();
        if(!symbol||!isin)continue;
        if(assetType==="equity"&&!["EQ","BE","BZ","ST","SM","SZ"].includes(series))continue;
        add(out,{symbol,name,isin,exchanges:["NSE"],assetType,series,nseSymbol:symbol})
      }
    }catch(e){console.warn("NSE source unavailable:",String(e))}
  }
  try{
    const r=await get(BSE_URL,{headers:{"Referer":"https://www.bseindia.com/markets/equity/EQReports/List_Scrips.aspx","Origin":"https://www.bseindia.com"}});
    const data=await r.json();
    const rows=Array.isArray(data)?data:(data.Table||data.Data||[]);
    for(const r of rows){
      const bseCode=String(r.SecurityCode??r.ScripCode??r.scripcode??"").trim();
      const symbol=String(r.Scrip_ID??r.scrip_id??r.SecurityID??r.securityid??"").trim();
      const name=String(r.SecurityName??r.Scrip_Name??r.scripname??r.CompanyName??"").trim();
      const isin=String(r.ISIN??r.Isin??r.isin??"").trim();
      add(out,{symbol:symbol||bseCode,name:name||symbol||bseCode,isin,exchanges:["BSE"],assetType:"equity",bseCode})
    }
  }catch(e){console.warn("BSE source unavailable:",String(e))}
  const items=[...out.values()].filter(x=>x.symbol||x.bseCode).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  if(items.length<100)throw new Error("Exchange sync produced too few instruments ("+items.length+"); refusing to overwrite the master.");
  await fs.mkdir("data",{recursive:true});
  await fs.writeFile("data/instruments.json",JSON.stringify({updatedAt:new Date().toISOString(),source:"NSE/BSE exchange security masters",count:items.length,items},null,2)+"\n");
  console.log("Synced",items.length,"instruments to exchange master");
  if(process.env.DATABASE_URL){
    const sql=neon(process.env.DATABASE_URL);
    await sql`CREATE TEMP TABLE stocklens_instrument_stage (LIKE instruments INCLUDING DEFAULTS) ON COMMIT DROP`;
    for(const item of items){
      const exchange=item.exchanges?.[0]||"NSE";
      const symbol=item.symbol||item.bseCode;
      await sql`INSERT INTO stocklens_instrument_stage (isin,symbol,exchange,asset_type,series,company_name,currency,active,source,source_updated_at,nse_symbol,bse_code) VALUES (${item.isin||null},${symbol},${exchange},${item.assetType||"equity"},${item.series||null},${item.name||symbol},${exchange==="NSE"?"INR":"INR"},true,"NSE/BSE exchange security master",now(),${item.nseSymbol||null},${item.bseCode||null})`;
    }
    await sql`INSERT INTO instruments (isin,symbol,exchange,asset_type,series,company_name,currency,active,source,source_updated_at,nse_symbol,bse_code) SELECT isin,symbol,exchange,asset_type,series,company_name,currency,active,source,source_updated_at,nse_symbol,bse_code FROM stocklens_instrument_stage s ON CONFLICT (id) DO NOTHING`;
    for(const item of items){
      const exchange=item.exchanges?.[0]||"NSE"; const symbol=item.symbol||item.bseCode;
      await sql`UPDATE instruments SET isin=${item.isin||null},asset_type=${item.assetType||"equity"},series=${item.series||null},company_name=${item.name||symbol},currency="INR",active=true,source="NSE/BSE exchange security master",source_updated_at=now(),nse_symbol=${item.nseSymbol||null},bse_code=${item.bseCode||null},updated_at=now() WHERE exchange=${exchange} AND symbol=${symbol}`;
      await sql`INSERT INTO instruments (isin,symbol,exchange,asset_type,series,company_name,currency,active,source,source_updated_at,nse_symbol,bse_code) SELECT ${item.isin||null},${symbol},${exchange},${item.assetType||"equity"},${item.series||null},${item.name||symbol},"INR",true,"NSE/BSE exchange security master",now(),${item.nseSymbol||null},${item.bseCode||null} WHERE NOT EXISTS (SELECT 1 FROM instruments WHERE exchange=${exchange} AND symbol=${symbol})`;
    }
    console.log("Neon instrument master updated");
  } else console.warn("DATABASE_URL not configured; Neon sync skipped")
}
main().catch(e=>{console.error(e);process.exit(1)})
