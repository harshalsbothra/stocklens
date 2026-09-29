import {NextResponse} from "next/server";
import {getDb} from "../../../lib/db";
import commodities from "../../../data/commodities.json";

export async function GET(request:Request){
  try{
    const sql=getDb();
    const rows=await sql`SELECT symbol,exchange,name,asset_type AS "assetType",unit,currency,active,source,updated_at AS "updatedAt" FROM commodities WHERE active=true ORDER BY name ASC`;
    const params=new URL(request.url).searchParams;
    const ticker=(params.get("ticker")||"").toUpperCase();
    if(!ticker)return NextResponse.json({source:"Neon Postgres commodity master",count:rows.length,items:rows},{headers:{"Cache-Control":"public, s-maxage=3600, stale-while-revalidate=86400"}});
    const item=rows.find((x:any)=>String(x.symbol).toUpperCase()===ticker);
    if(!item)return NextResponse.json({error:"Commodity not found in MCX master"},{status:404});
    return NextResponse.json({ticker,item,source:item.source||"MCX contract master",marketData:"MCX licensed market-data feed required"});
  }catch{
    const list=(commodities as any).items||commodities;
    const params=new URL(request.url).searchParams;
    const ticker=(params.get("ticker")||"").toUpperCase();
    const item=(list as any[]).find((x:any)=>String(x.symbol).toUpperCase()===ticker);
    return NextResponse.json(ticker?(item?{ticker,item,source:"MCX contract catalogue",marketData:"MCX licensed market-data feed required"}:{error:"Commodity not found in MCX master"}):commodities,{headers:{"Cache-Control":"public, s-maxage=300, stale-while-revalidate=3600"}});
  }
}