import {NextResponse} from "next/server";
import {getDb} from "../../../lib/db";

const groups={revenue:"annualTotalRevenue",netIncome:"annualNetIncome",eps:"annualDilutedEPS",freeCashFlow:"annualFreeCashFlow",operatingCashFlow:"annualOperatingCashFlow",debt:"annualTotalDebt",equity:"annualStockholdersEquity",cash:"annualCashCashEquivalentsAndShortTermInvestments"};
type Row={date:string;value:number};

function rows(result:any,key:string):Row[]{
  const r=result?.timeseries?.result?.find((x:any)=>Array.isArray(x[key]));
  return (r?.timestamp||[]).map((t:number,i:number)=>({date:new Date(t*1000).toISOString().slice(0,10),value:Number(r[key]?.[i]?.raw??r[key]?.[i]??NaN)})).filter((x:Row)=>Number.isFinite(x.value)).sort((a:Row,b:Row)=>a.date.localeCompare(b.date)).slice(-5);
}
async function getSeries(symbol:string){
  for(const host of ["query2.finance.yahoo.com","query1.finance.yahoo.com"]){
    const u=new URL(`https://${host}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`);
    u.searchParams.set("symbol",symbol);u.searchParams.set("type",Object.values(groups).join(","));u.searchParams.set("period1","1483142400");u.searchParams.set("period2",String(Math.floor(Date.now()/1000)));
    const r=await fetch(u,{cache:"no-store",headers:{"User-Agent":"StockLens/1.0"}});
    if(r.ok)return r.json();
  }
  throw new Error("Fundamentals provider unavailable");
}
export async function GET(request:Request){
  const ticker=(new URL(request.url).searchParams.get("ticker")||"").toUpperCase();
  if(!/^[A-Z0-9&-]{1,30}$/.test(ticker))return NextResponse.json({error:"Invalid ticker"},{status:400});
  try{
    const sql=getDb();
    const rowsDb=await sql`SELECT symbol,nse_symbol AS "nseSymbol",exchange,company_name AS "name",sector,industry FROM instruments WHERE active=true AND upper(symbol)=${ticker} LIMIT 2`;
    const instrument=rowsDb.find((r:any)=>r.nseSymbol||r.exchange==="NSE");
    if(!instrument)return NextResponse.json({error:"Instrument not found in StockLens master"},{status:404});
    const symbol=String(instrument.nseSymbol||instrument.symbol)+".NS";
    const data=await getSeries(symbol);
    const out:any={ticker,symbol,currency:"INR",source:"Yahoo Finance fundamentals time series",updatedAt:new Date().toISOString(),profile:{name:instrument.name||ticker,sector:instrument.sector||"",industry:instrument.industry||"",description:""},revenue:[],netIncome:[],eps:[],freeCashFlow:[],operatingCashFlow:[],debt:[],equity:[],cash:[]};
    for(const [name,key] of Object.entries(groups))out[name]=rows(data,key);
    return NextResponse.json(out,{headers:{"Cache-Control":"s-maxage=900, stale-while-revalidate=3600"}});
  }catch(error){
    return NextResponse.json({error:"Fundamentals unavailable",detail:error instanceof Error?error.message:"Unknown provider error"},{status:502});
  }
}
