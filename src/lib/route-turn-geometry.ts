import type { FeatureCollection, LineString, Point } from "geojson";
import { bearingBetween, distanceMeters, type LngLatTuple } from "./location";
import type { Maneuver } from "./route-maneuvers";
import { measureRouteProgress, routeSlice } from "./route-progress";

export type TurnFeatures = FeatureCollection<LineString | Point, { bearing?: number }>;
function roundedShaft(points: LngLatTuple[]): LngLatTuple[] {
  const result=[points[0]];
  const mix=(a:LngLatTuple,b:LngLatTuple,t:number):LngLatTuple=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  for(let i=1;i+1<points.length;i++){
    const a=points[i-1],b=points[i],c=points[i+1],before=distanceMeters(a,b),after=distanceMeters(b,c);
    const first=bearingBetween(a,b),last=bearingBetween(b,c);
    const angle=first===null||last===null?180:Math.abs(((last-first+540)%360)-180);
    if(before<.5||after<.5||angle<8||angle>150){result.push(b);continue;}
    const radius=Math.min(2.5,before*.25,after*.25);
    const enter=mix(b,a,radius/before),exit=mix(b,c,radius/after);result.push(enter);
    for(const t of [.25,.5,.75])result.push(mix(mix(enter,b,t),mix(b,exit,t),t));
    result.push(exit);
  }
  result.push(points[points.length-1]);return result;
}

export function routeTurnFeatures(route: readonly LngLatTuple[], steps: readonly Maneuver[], progress = 0): TurnFeatures {
  const features: TurnFeatures["features"] = [];
  const turns = steps.filter(s => s.type !== "arrive" && s.type !== "depart" && s.coordinate
    && (s.modifier !== "straight" || /roundabout|rotary/.test(s.type))).sort((a,b) => a.atMeters - b.atMeters);
  let count = 0, lastAt = -Infinity;
  for (let i = 0; i < turns.length && count < 8; i++) {
    const step = turns[i];
    if (step.atMeters < progress - 5 || step.atMeters > progress + 1500 || step.atMeters - lastAt < 5) continue;
    const projection = measureRouteProgress(step.coordinate!, route, { previousMeters: step.atMeters, maxAdvanceMeters: 10 });
    if (!projection || projection.offRouteMeters > 12 || Math.abs(projection.progressedMeters - step.atMeters) > 30) continue;
    const at = projection.progressedMeters;
    const before = Math.min(22, i ? Math.max(3, (at - turns[i-1].atMeters) * .35) : 22);
    const after = Math.min(26, i+1 < turns.length ? Math.max(3, (turns[i+1].atMeters - at) * .35) : 26);
    const coordinates = routeSlice(route, Math.max(progress, at - before), at + after);
    const end = coordinates.at(-1), previous = coordinates.at(-2);
    const bearing = end && previous ? bearingBetween(previous, end) : null;
    if (coordinates.length < 2 || bearing === null) continue;
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: roundedShaft(coordinates) } },
      { type: "Feature", properties: { bearing }, geometry: { type: "Point", coordinates: end! } });
    count++; lastAt = at;
  }
  return { type: "FeatureCollection", features };
}
