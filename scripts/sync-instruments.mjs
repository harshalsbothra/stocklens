import fs from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
const NSE_URL="https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const NSE_SME_URL="https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv";
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
    const bseHeaders={
      "Host":"api.bseindia.com",
      "Referer":"https://www.bseindia.com/corporates/ann.html",
      "User-Agent":"Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.6998.166 Safari/537.36",
      "Sec-CH-UA":'"Google Chrome";v="134", "Chromium";v="134", "Not?A_Brand";v="99"',
      "Sec-CH-UA-Mobile":"?0",
      "Sec-CH-UA-Platform":'"Windows"',
      "DNT":"1",
      "Accept":"application/json, text/plain, */*",
      "Accept-Language":"en-US,en;q=0.9",
      "Cache-Control":"no-cache",
      "Connection":"keep-alive"
    };
    const bseUrl=BSE_URL+"?"+new URLSearchParams({scripcode:"",Group:"",industry:"",segment:"Equity",status:"Active"}).toString();
    const response=await fetch(bseUrl,{headers:bseHeaders});
    if(!response.ok)throw new Error("BSE "+response.status);
    const data=await response.json();
    const rows=Array.isArray(data)?data:(data.Table||data.Data||[]);
    for(const r of rows){
      const bseCode=String(r.SCRIP_CD??r.ScripCode??r.SecurityCode??r.scripcode??"").trim();
      const symbol=String(r.scrip_id??r.Scrip_ID??r.ScripId??r.SecurityID??"").trim();
      const name=String(r.Scrip_Name??r.SecurityName??r.scripname??r.CompanyName??"").trim();
      const isin=String(r.ISIN_NUMBER??r.ISIN??r.Isin??r.isin??"").trim();
      if(!bseCode&&!symbol)continue;
      add(out,{symbol:symbol||bseCode,name:name||symbol||bseCode,isin,exchanges:["BSE"],assetType:"equity",series:String(r.GROUP??r.Group??r.group??""),bseCode});
    }
  }catch(e){console.warn("BSE source unavailable:",String(e))}
  const items=[...out.values()].filter(x=>x.symbol||x.bseCode).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const nseCount=items.filter(x=>x.exchanges?.includes("NSE")).length;
  const bseCount=items.filter(x=>x.exchanges?.includes("BSE")).length;
  if(nseCount<1000)throw new Error("Exchange sync produced too few NSE instruments ("+nseCount+"); refusing to overwrite the master.");
  if(bseCount<1000)console.warn("BSE master unavailable from current network (BSE="+bseCount+"). NSE will still be synchronized; existing BSE rows will be preserved.");
  await fs.mkdir("data",{recursive:true});
  await fs.writeFile("data/instruments.json",JSON.stringify({updatedAt:new Date().toISOString(),source:"NSE/BSE exchange security masters",count:items.length,items},null,2)+"\n");
  console.log("Synced",items.length,"instruments to exchange master");
  if(process.env.DATABASE_URL){
    const sql=neon(process.env.DATABASE_URL);
    await sql`UPDATE instruments SET active=false, updated_at=now() WHERE exchange='NSE' AND asset_type IN ('equity','sme')`;
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
