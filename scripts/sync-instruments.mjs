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
  const exchange=item.exchanges?.[0]||"NSE";
  const key=exchange+":"+String(item.symbol||item.bseCode);
  const old=map.get(key);
  map.set(key,old?{...old,...item,isin:old.isin||item.isin,name:old.name||item.name}:item);
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
    const groupData=await fetch("https://api.bseindia.com/BseIndiaAPI/api/BindDDLEQ/w?flag=Group",{headers:{...headers,"Host":"api.bseindia.com","Referer":"https://www.bseindia.com/corporates/ann.html","Origin":"https://www.bseindia.com"}}).then(x=>x.ok?x.json():Promise.reject(new Error("BSE groups "+x.status)));
    const groups=[...new Set((Array.isArray(groupData)?groupData:(groupData.Table||[])).map((x)=>String(x.Symbol??x.symbol??x.Group??x.group??"").trim()).filter(Boolean))];
    if(!groups.length)throw new Error("BSE returned no security groups");
    const seen=new Set();
    for(const group of groups){
      const data=await fetch(BSE_URL+"?"+new URLSearchParams({scripcode:"",Group:group,industry:"",segment:"Equity",status:"Active"}).toString(),{headers:{...headers,"Host":"api.bseindia.com","Referer":"https://www.bseindia.com/corporates/ann.html","Origin":"https://www.bseindia.com","Accept":"application/json, text/plain, */*"}}).then(x=>x.ok?x.json():Promise.reject(new Error("BSE "+x.status)));
      const rows=Array.isArray(data)?data:(data.Table||data.Data||[]);
      for(const r of rows){
        const bseCode=String(r.ScripCode??r.SecurityCode??r.scripcode??r.SCRIP_CD??"").trim();
        const symbol=String(r.Scrip_ID??r.ScripId??r.SecurityID??r.securityid??r.scrip_id??r.SC_CODE??"").trim();
        const name=String(r.SecurityName??r.Scrip_Name??r.scripname??r.CompanyName??r.scrip_name??r.LONG_NAME??"").trim();
        const isin=String(r.ISIN??r.Isin??r.isin??r.ISIN_CODE??"").trim();
        const key=bseCode||symbol||isin;
        if(!key||seen.has(key))continue;
        seen.add(key);
        add(out,{symbol:symbol||bseCode,name:name||symbol||bseCode,isin,exchanges:["BSE"],assetType:"equity",series:String(r.Group??r.group??group),bseCode});
      }
    }
  }catch(e){console.warn("BSE source unavailable:",String(e))}
  const items=[...out.values()].filter(x=>x.symbol||x.bseCode).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const nseCount=items.filter(x=>x.exchanges?.includes("NSE")).length;
  const bseCount=items.filter(x=>x.exchanges?.includes("BSE")).length;
  if(nseCount<1000||bseCount<1000)throw new Error("Exchange sync produced too few instruments (NSE="+nseCount+", BSE="+bseCount+"); refusing to overwrite the master.");
  await fs.mkdir("data",{recursive:true});
  await fs.writeFile("data/instruments.json",JSON.stringify({updatedAt:new Date().toISOString(),source:"NSE/BSE exchange security masters",count:items.length,items},null,2)+"\n");
  console.log("Synced",items.length,"instruments to exchange master");
  if(process.env.DATABASE_URL){
    const sql=neon(process.env.DATABASE_URL);
    await sql`UPDATE instruments SET active=false, updated_at=now() WHERE exchange IN ('NSE','BSE') AND asset_type IN ('equity','sme')`;
    const rows=items.map(item=>({
      isin:item.isin||null,symbol:item.symbol||item.bseCode,exchange:item.exchanges?.[0]||"NSE",
      assetType:item.assetType||"equity",series:item.series||null,name:item.name||item.symbol||item.bseCode,
      nseSymbol:item.nseSymbol||null,bseCode:item.bseCode||null
    }));
    for(let i=0;i<rows.length;i+=100){
      const batch=rows.slice(i,i+100);
      await sql.transaction(batch.map(item=>sql`INSERT INTO instruments (isin,symbol,exchange,asset_type,series,company_name,currency,active,source,source_updated_at,nse_symbol,bse_code)
        VALUES (${item.isin},${item.symbol},${item.exchange},${item.assetType},${item.series},${item.name},"INR",true,"NSE/BSE exchange security master",now(),${item.nseSymbol},${item.bseCode})
        ON CONFLICT (exchange,symbol) DO UPDATE SET
          isin=excluded.isin,asset_type=excluded.asset_type,series=excluded.series,company_name=excluded.company_name,currency=excluded.currency,active=true,source=excluded.source,source_updated_at=excluded.source_updated_at,nse_symbol=excluded.nse_symbol,bse_code=excluded.bse_code,updated_at=now()`));
    }
    console.log("Neon instrument master updated:",rows.length);
  } else console.warn("DATABASE_URL not configured; Neon sync skipped")
}
main().catch(e=>{console.error(e);process.exit(1)})
