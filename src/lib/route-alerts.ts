import type { FeatureCollection, LineString, Point } from "geojson";
import { measureRouteProgress, routeSlice } from "./route-progress";
import { roadHazardDetails, roadHazardKind } from "./road-hazards";
import type { LngLatTuple } from "./location";
import type { Maneuver } from "./route-maneuvers";

export type RoadAlertPoint = { id: string; kind: string; coordinate: LngLatTuple };
export type RouteAlert = RoadAlertPoint & { at: number; start: number; end: number; color: string; priority: number };
type AlertProperties = { kind: string; color: string; priority: number; at: number };
export type RouteAlertFeatures = FeatureCollection<LineString | Point, AlertProperties>;
// Approach/exit distances are route distance, never circles or straight lines
// through neighbouring roads. A checkpoint spans 3 km, a bump 1.5 km.
const WINDOWS: Record<string, [number, number, number]> = {
  checkpoint: [1500,1500,4], border_crossing: [1500,1500,4], speed_bump: [1000,500,3],
  dangerous_road: [1000,500,5], speed_camera: [600,100,2], railway_crossing: [400,100,3],
  pedestrian_crossing: [200,60,1], traffic_signal: [150,50,1], sharp_curve: [180,60,2], uturn: [180,60,2]
};

export function projectRouteAlerts(route: readonly LngLatTuple[], points: readonly RoadAlertPoint[], steps: readonly Maneuver[]): RouteAlert[] {
  if (route.length < 2) return [];
  const result: RouteAlert[] = [], seen = new Set<string>();
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  for (const [x,y] of route) {west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,y);north=Math.max(north,y);}
  const append = (point:RoadAlertPoint,at:number,total:number,coordinate:LngLatTuple) => {
    const kind=roadHazardKind(point.kind), window=kind ? WINDOWS[kind] : null;
    if (!kind || !window) return;
    const key=`${kind}:${Math.round(at/10)}`;
    if(seen.has(key))return;seen.add(key);
    result.push({...point,kind,coordinate,at,start:Math.max(0,at-window[0]),end:Math.min(total,at+window[1]),color:roadHazardDetails(kind,"en")!.color,priority:window[2]});
  };
  for(const point of points) {
    const [x,y]=point.coordinate;
    if(!Number.isFinite(x)||!Number.isFinite(y)||!WINDOWS[roadHazardKind(point.kind)??""] || x<west-.001||x>east+.001||y<south-.001||y>north+.001)continue;
    const projection=measureRouteProgress(point.coordinate,route);
    // Nearby parallel streets must not inherit another road's warning.
    if(projection && projection.offRouteMeters<=20) append(point,projection.progressedMeters,projection.totalMeters,projection.coordinate);
  }
  for(const [index,step] of steps.entries()) {
    const kind=step.modifier==="uturn"?"uturn":step.modifier.startsWith("sharp ")?"sharp_curve":null;
    if(!kind||!step.coordinate)continue;
    const projection=measureRouteProgress(step.coordinate,route,{previousMeters:step.atMeters,maxAdvanceMeters:25});
    if(projection&&projection.offRouteMeters<=20)append({id:`maneuver-${index}`,kind,coordinate:step.coordinate},projection.progressedMeters,projection.totalMeters,projection.coordinate);
  }
  return result.sort((a,b)=>a.priority-b.priority||a.at-b.at);
}

export function routeAlertFeatures(route: readonly LngLatTuple[], alerts: readonly RouteAlert[], progress=0): RouteAlertFeatures {
  const features: RouteAlertFeatures["features"]=[];
  for(const alert of alerts) {
    if(alert.end<=progress)continue;
    const properties={kind:alert.kind,color:alert.color,priority:alert.priority,at:alert.at};
    const coordinates=routeSlice(route,Math.max(progress,alert.start),alert.end);
    if(coordinates.length>=2)features.push({type:"Feature",properties,geometry:{type:"LineString",coordinates}});
    if(alert.at>=progress-5)features.push({type:"Feature",properties,geometry:{type:"Point",coordinates:alert.coordinate}});
  }
  return {type:"FeatureCollection",features};
}
