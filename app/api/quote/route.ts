import { NextResponse } from "next/server";

const symbols: Record<string,string> = {
  RELIANCE:"RELIANCE.NS",
  TCS:"TCS.NS",
  HDFCBANK:"HDFCBANK.NS",
  INFY:"INFY.NS",
  NIFTY:"^NSEI",
  SENSEX:"^BSESN",
  BANKNIFTY:"^NSEBANK",
};

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ticker = params.get("ticker")?.toUpperCase() || "";
  const range = params.get("range") || "1d";
  const intervalByRange: Record<string,string> = { "1d":"5m", "1w":"30m", "1mo":"1h", "1y":"1d", "5y":"1wk" };
  const interval = intervalByRange[range] || "5m";
  const symbol = symbols[ticker] || (ticker.endsWith(".NS") || ticker.startsWith("^") ? ticker : null);
  if (!symbol) return NextResponse.json({ error:"Unsupported ticker" }, { status:400 });

  try {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.searchParams.set("range",range);
    url.searchParams.set("interval",interval);
    url.searchParams.set("includePrePost","true");
    const response = await fetch(url, { cache:"no-store", headers:{ "User-Agent":"StockLens/1.0" } });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);
    const json = await response.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) throw new Error("No quote data returned");

    const price = Number(meta.regularMarketPrice ?? meta.postMarketPrice ?? meta.previousClose);
    const previousClose = Number(meta.previousClose ?? meta.chartPreviousClose ?? price);
    const change = price - previousClose;
    const changePct = previousClose ? (change / previousClose) * 100 : 0;
    const timestamps: number[] = result?.timestamp ?? [];
    const closes: Array<number|null> = result?.indicators?.quote?.[0]?.close ?? [];
    const points = timestamps.map((ts,i)=>({ t:ts*1000, v:closes[i] })).filter((p)=>typeof p.v==="number").slice(-120);

    return NextResponse.json({
      ticker,
      symbol,
      price,
      previousClose,
      change,
      changePct,
      currency: meta.currency || "INR",
      exchange: meta.exchangeName || "NSE",
      marketState: meta.marketState || "CLOSED",
      asOf: new Date((meta.regularMarketTime || Math.floor(Date.now()/1000))*1000).toISOString(),
      range,
      interval,
      points,
      source:"Yahoo Finance chart feed",
    }, { headers:{ "Cache-Control":"no-store" }});
  } catch (error) {
    return NextResponse.json({ error:"Live market data unavailable", detail:error instanceof Error ? error.message : "Unknown provider error" }, { status:502 });
  }
}
