import {NextResponse} from "next/server";
import {getDb} from "@/lib/db";
import commodities from "@/data/commodities.json";

export async function GET(){
  try {
    const sql=getDb();
    const rows=await sql`SELECT symbol,exchange,name,asset_type AS "assetType",unit,currency,active,source,updated_at AS "updatedAt" FROM commodities WHERE active=true ORDER BY name ASC`;
    return NextResponse.json(
      {source:"Neon Postgres commodity master",count:rows.length,items:rows},
      {headers:{"Cache-Control":"public, s-maxage=3600, stale-while-revalidate=86400"}}
    );
  } catch {
    return NextResponse.json(commodities,{headers:{"Cache-Control":"public, s-maxage=300, stale-while-revalidate=3600"}});
  }
}
