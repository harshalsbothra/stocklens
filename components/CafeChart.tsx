"use client";
import {useState} from "react";
type Point={t:number;v:number};
const fmt=(n:number)=>n.toLocaleString("en-IN",{maximumFractionDigits:2});
const shortDate=(t:number)=>new Date(t).toLocaleDateString("en-IN",{day:"2-digit",month:"short"});
export default function CafeChart({points,positive}:{points:Point[];positive:boolean}){
 const [hover,setHover]=useState<number|null>(null);
 if(points.length<2)return <div className="price-trail price-trail-empty"><div className="trail-empty-state"><span>PRICE TRAIL</span><b>Historical points are not available yet.</b><small>Once the market-data provider returns timestamped prices, the trail will appear here. No placeholder prices are shown.</small></div></div>;
 const vals=points.map(p=>p.v);
 const min=Math.min(...vals),max=Math.max(...vals),range=max-min||Math.max(Math.abs(max)*.02,1),pad=range*.12,lo=min-pad,hi=max+pad;
 const xy=points.map((p,i)=>({x:(i/(points.length-1))*100,y:88-((p.v-lo)/(hi-lo))*72}));
 const d=xy.map((p,i)=>(i?"L":"M")+p.x.toFixed(2)+","+p.y.toFixed(2)).join(" ");
 const first=points[0].v,last=points.at(-1)!.v,delta=first?((last-first)/Math.abs(first))*100:0;
 const high=Math.max(...vals),low=Math.min(...vals),active=hover==null?points.length-1:hover,ap=points[active],pos=xy[active],yTicks=[hi,(hi+lo)/2,lo];
 return <div className={"price-trail "+(positive?"trail-positive":"trail-negative")}>
  <div className="trail-stats"><div><span>NOW</span><b>{fmt(last)}</b></div><div><span>TRAIL</span><b className={delta>=0?"matcha":"berry"}>{delta>=0?"+":""}{delta.toFixed(2)}%</b></div><div><span>HIGH</span><b>{fmt(high)}</b></div><div><span>LOW</span><b>{fmt(low)}</b></div></div>
  <div className="trail-plot" onMouseLeave={()=>setHover(null)}>
   <div className="trail-axis">{yTicks.map((v,i)=><span key={i}>{fmt(v)}</span>)}</div>
   <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Price trail chart">
    {[16,52,88].map(y=><line key={y} x1="0" x2="100" y1={y} y2={y} stroke="currentColor" strokeOpacity=".13" strokeWidth=".35" vectorEffect="non-scaling-stroke"/>)}
    <path d={d+" L100,92 L0,92 Z"} fill="currentColor" opacity=".055"/><path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke"/>
    {xy.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={hover===i?2.1:1.05} fill="currentColor" opacity={hover===i?1:.35} vectorEffect="non-scaling-stroke" onMouseEnter={()=>setHover(i)}/>)}
    {pos&&<line x1={pos.x} x2={pos.x} y1="8" y2="92" stroke="currentColor" strokeOpacity=".24" strokeDasharray="2 2" vectorEffect="non-scaling-stroke"/>}
   </svg>
   {ap&&pos&&<div className="trail-tooltip" style={{left:pos.x+"%",top:Math.max(5,pos.y)+"%"}}><b>₹{fmt(ap.v)}</b><span>{shortDate(ap.t)}</span></div>}
  </div>
  <div className="trail-footer"><span>{shortDate(points[0].t)}</span><span>{hover!=null?"Hover the dots to inspect a quote":"Move across the trail to inspect price"}</span><span>{shortDate(points.at(-1)!.t)}</span></div>
 </div>;
}