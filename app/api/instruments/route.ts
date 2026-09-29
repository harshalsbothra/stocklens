import {NextResponse} from "next/server";
import {getDb} from "../../../lib/db";

export async function GET(){
  try {
    const sql=getDb();
    const rows=await sql`SELECT id,isin,symbol,exchange,asset_type AS "assetType",series,company_name AS "name",currency,sector,industry,active,source,source_updated_at AS "sourceUpdatedAt" FROM instruments WHERE active=true ORDER BY company_name ASC, symbol ASC`;
    return NextResponse.json(
      {updatedAt:new Date().toISOString(),source:"Neon Postgres instrument master",count:rows.length,items:rows},
      {headers:{"Cache-Control":"public, s-maxage=3600, stale-while-revalidate=86400"}}
    );
  } catch {
    return NextResponse.json({error:"Instrument master unavailable"},{status:503});
  }
}

