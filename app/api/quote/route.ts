import { NextResponse } from "next/server";
import {getDb} from "@/lib/db";

const indices:Record<string,string>={NIFTY:"^NSEI",SENSEX:"^BSESN",BANKNIFTY:"^NSEBANK"};
const ranges:Record<string,string>={"1d":"5m","1w":"30m","1mo":"1h","1y":"1d","5y":"1wk"};

export async function GET(request:Request){
  const params=new URL(request.url).searchParams;
  const ticker=(params.get("ticker")||"").toUpperCase();
  const range=params.get("range")||"1d";
  const interval=ranges[range]||"5m";
  let symbol=indices[ticker]||"";
  try{
    if(!symbol){
      const sql=getDb();
      const rows=await sql`SELECT symbol,nse_symbol AS "nseSymbol",exchange FROM instruments WHERE active=true AND upper(symbol)=${ticker} LIMIT 2`;
      const nse=rows.find((r:any)=>r.nseSymbol||r.exchange==="NSE");
      if(!nse) return NextResponse.json({error:"Instrument not found in StockLens master"},{status:404});
      symbol=String(nse.nseSymbol||nse.symbol)+".NS";
    }
    const url=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.searchParams.set("range",range); url.searchParams.set("interval",interval); url.searchParams.set("includePrePost","true");
    const response=await fetch(url,{cache:"no-store",headers:{"User-Agent":"StockLens/1.0"}});
    if(!response.ok) throw new Error(`Provider returned ${response.status}`);
    const json=await response.json(),result=json?.chart?.result?.[0],meta=result?.meta;
    if(!meta) throw new Error("No quote data returned");
    const price=Number(meta.regularMarketPrice??meta.postMarketPrice??meta.previousClose);
    const previousClose=Number(meta.previousClose??meta.chartPreviousClose??price);
    const change=price-previousClose,changePct=previousClose?(change/previousClose)*100:0;
    const timestamps:number[]=result?.timestamp??[];
    const closes:Array<number|null>=result?.indicators?.quote?.[0]?.close??[];
    const points=timestamps.map((ts,i)=>({t:ts*1000,v:closes[i]})).filter((p):p is {t:number;v:number}=>typeof p.v==="number").slice(-180);
    return NextResponse.json({ticker,symbol,price,previousClose,change,changePct,currency:meta.currency||"INR",exchange:meta.exchangeName||"NSE",marketState:meta.marketState||"CLOSED",asOf:new Date((meta.regularMarketTime||Math.floor(Date.now()/1000))*1000).toISOString(),range,interval,points,source:"Yahoo Finance chart feed"},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    return NextResponse.json({error:"Live market data unavailable",detail:error instanceof Error?error.message:"Unknown provider error"},{status:502});
  }
}
