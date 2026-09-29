import {NextResponse} from "next/server";
import instruments from "@/data/instruments.json";

export async function GET(){
  return NextResponse.json(
    {updatedAt:instruments.updatedAt,source:instruments.source,count:instruments.items.length,items:instruments.items},
    {headers:{"Cache-Control":"public, s-maxage=3600, stale-while-revalidate=86400"}}
  );
}