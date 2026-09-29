import {NextResponse} from "next/server";
import {getDb} from "../../../lib/db";

const indices:Record<string,string>={NIFTY:"^NSEI",SENSEX:"^BSESN",BANKNIFTY:"^NSEBANK"};
const ranges:Record<string,string>={"1d":"5m","1w":"30m","1mo":"1h","1y":"1d","5y":"1wk"};

type NormalizedQuote={
  ticker:string; symbol:string; price:number; previousClose:number; change:number; changePct:number;
  currency:string; exchange:string; marketState:string; asOf:string;
  range:string; interval:string; points:{t:number;v:number}[]; source:string;
};

async function fetchLicensedFeed(exchange:string,ticker:string,range:string,interval:string):Promise<NormalizedQuote|null>{
  const prefix=exchange==="NSE"?"NSE":exchange==="BSE"?"BSE":"MCX";
  const base=process.env[`STOCKLENS_${prefix}_FEED_URL`];
  if(!base)return null;
  const url=new URL(base);
  url.searchParams.set("ticker",ticker);
  url.searchParams.set("range",range);
  url.searchParams.set("interval",interval);
  const token=process.env[`STOCKLENS_${prefix}_FEED_TOKEN`];
  const response=await fetch(url,{cache:"no-store",headers:{
    Accept:"application/json",
    ...(token?{Authorization:`Bearer ${token}`}:{})
  }});
  if(!response.ok)throw new Error(`${prefix} feed returned ${response.status}`);
  const data=await response.json();
  const quote=data?.quote||data;
  const price=Number(quote?.price??quote?.ltp);
  if(!Number.isFinite(price))throw new Error(`${prefix} feed returned no normalized price`);
  const previousClose=Number(quote?.previousClose??quote?.prevClose??price);
  const change=Number(quote?.change??(price-previousClose));
  const changePct=Number(quote?.changePct??quote?.percentChange??(previousClose?(change/previousClose)*100:0));
  const points=Array.isArray(quote?.points)?quote.points.map((p:any)=>({t:Number(p.t),v:Number(p.v)})).filter((p:any)=>Number.isFinite(p.t)&&Number.isFinite(p.v)).slice(-180):[];
  return {
    ticker,symbol:String(quote?.symbol??ticker),price,previousClose,change,changePct,
    currency:String(quote?.currency??"INR"),exchange:String(quote?.exchange??exchange),
    marketState:String(quote?.marketState??"UNKNOWN"),
    asOf:new Date(quote?.asOf??Date.now()).toISOString(),
    range,interval,points,source:String(quote?.source??`${exchange} licensed market-data feed`)
  };
}

export async function GET(request:Request){
  const params=new URL(request.url).searchParams;
  const ticker=(params.get("ticker")||"").toUpperCase();
  const range=params.get("range")||"1d";
  const interval=ranges[range]||"5m";
  if(!ticker)return NextResponse.json({error:"ticker is required"},{status:400});

  let exchange="NSE";
  let symbol=indices[ticker]||"";
  try{
    if(!symbol){
      const sql=getDb();
      const rows=await sql`SELECT symbol,nse_symbol AS "nseSymbol",bse_code AS "bseCode",exchange FROM instruments WHERE active=true AND upper(symbol)=${ticker} ORDER BY CASE WHEN exchange='NSE' THEN 0 WHEN exchange='BSE' THEN 1 ELSE 2 END LIMIT 2`;
      const instrument=rows[0];
      if(instrument){
        exchange=String(instrument.exchange||"NSE").toUpperCase();
        if(exchange==="BSE")symbol=String(instrument.bseCode||instrument.symbol);
        else symbol=String(instrument.nseSymbol||instrument.symbol);
      } else {
        const commodities=await sql`SELECT symbol,exchange FROM commodities WHERE active=true AND upper(symbol)=${ticker} LIMIT 1`;
        const commodity=commodities[0];
        if(!commodity)return NextResponse.json({error:"Instrument or MCX contract not found in StockLens master"},{status:404});
        exchange=String(commodity.exchange||"MCX").toUpperCase();
        symbol=String(commodity.symbol);
      }
    } else if(ticker==="SENSEX") exchange="BSE";

    const licensed=await fetchLicensedFeed(exchange,ticker,range,interval);
    if(licensed)return NextResponse.json(licensed,{headers:{"Cache-Control":"no-store"}});

    // Development fallback only. Production StockLens should set the exchange-specific
    // licensed feed URL/token so exchange data is not sourced from Yahoo.
    // Public/development fallback: Yahoo exposes Indian NSE (.NS) and BSE (.BO)
    // securities. MCX commodity contracts are not consistently exposed there, so
    // we keep MCX gated behind an authorized feed rather than substituting unrelated data.
    if(exchange==="MCX")return NextResponse.json({error:"MCX commodity market-data feed is not available from the public fallback source"},{status:503});

    const yahooSymbol=exchange==="BSE" ? `${symbol}.BO` : `${symbol}.NS`;
    const url=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`);
    url.searchParams.set("range",range); url.searchParams.set("interval",interval); url.searchParams.set("includePrePost","true");
    const response=await fetch(url,{cache:"no-store",headers:{"User-Agent":"StockLens/1.0"}});
    if(!response.ok)throw new Error(`Provider returned ${response.status}`);
    const json=await response.json(),result=json?.chart?.result?.[0],meta=result?.meta;
    if(!meta)throw new Error("No quote data returned");
    const price=Number(meta.regularMarketPrice??meta.postMarketPrice??meta.previousClose);
    const previousClose=Number(meta.previousClose??meta.chartPreviousClose??price);
    const change=price-previousClose,changePct=previousClose?(change/previousClose)*100:0;
    const timestamps:number[]=result?.timestamp??[];
    const closes:Array<number|null>=result?.indicators?.quote?.[0]?.close??[];
    const points=timestamps.map((ts,i)=>({t:ts*1000,v:closes[i]})).filter((p):p is {t:number;v:number}=>typeof p.v==="number").slice(-180);
    return NextResponse.json({ticker,symbol:yahooSymbol,price,previousClose,change,changePct,currency:meta.currency||"INR",exchange:exchange==="NSE"?"NSE":meta.exchangeName||exchange,marketState:meta.marketState||"CLOSED",asOf:new Date((meta.regularMarketTime||Math.floor(Date.now()/1000))*1000).toISOString(),range,interval,points,source:exchange==="BSE" ? "Yahoo Finance development fallback (BSE)" : "Yahoo Finance development fallback (NSE)"},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    return NextResponse.json({error:"Market data unavailable",detail:error instanceof Error?error.message:"Unknown provider error"},{status:502});
  }
}
