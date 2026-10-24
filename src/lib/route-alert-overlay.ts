import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { installRoadHazardImages, ROAD_HAZARD_DATA } from "./road-hazards";
import { projectRouteAlerts, routeAlertFeatures, type RoadAlertPoint, type RouteAlert } from "./route-alerts";
import type { LngLatTuple } from "./location";
import type { Maneuver } from "./route-maneuvers";

const SOURCE="nav-route-alert-source";
export const ROUTE_ALERT_LAYER_IDS=["nav-route-alert-casing","nav-route-alert-line","nav-route-alert-sign"] as const;
const mappedPoints: RoadAlertPoint[]=ROAD_HAZARD_DATA.features.map(f=>({id:String(f.properties?.id),kind:String(f.properties?.road_hazard),coordinate:f.geometry.coordinates as LngLatTuple}));

export class RouteAlertOverlay {
  private route: readonly LngLatTuple[]=[];
  private alerts:RouteAlert[]=[];
  private progress=0;
  constructor(private readonly map:MapLibreMap) {}
  ensureLayers():void {
    installRoadHazardImages(this.map);
    if(!this.map.getSource(SOURCE))this.map.addSource(SOURCE,{type:"geojson",data:routeAlertFeatures(this.route,this.alerts,this.progress),tolerance:0,maxzoom:22});
    for(const [index,width] of [8,5].entries())if(!this.map.getLayer(ROUTE_ALERT_LAYER_IDS[index]))this.map.addLayer({id:ROUTE_ALERT_LAYER_IDS[index],type:"line",source:SOURCE,filter:["==",["geometry-type"],"LineString"],layout:{"line-cap":"round","line-join":"round","line-sort-key":["get","priority"]},paint:{"line-color":index===0?"#102139":["get","color"],"line-width":["interpolate",["linear"],["zoom"],7,width*.45,16,width],"line-opacity":index===0?.8:.98}});
    if(!this.map.getLayer(ROUTE_ALERT_LAYER_IDS[2]))this.map.addLayer({id:ROUTE_ALERT_LAYER_IDS[2],type:"symbol",source:SOURCE,minzoom:11.5,filter:["==",["geometry-type"],"Point"],layout:{"icon-image":["concat","road-sign-",["get","kind"]],"icon-size":.9,"icon-allow-overlap":false,"icon-padding":12,"symbol-sort-key":["-",0,["get","priority"]],"icon-pitch-alignment":"viewport"}});
  }
  setRoute(route:readonly LngLatTuple[],_steps:readonly Maneuver[],extra:readonly RoadAlertPoint[]=[]):void {
    this.route=route;this.progress=0;this.alerts=projectRouteAlerts(route,[...mappedPoints,...extra],[]);this.render();
  }
  advance(progress:number,force=false):void {
    if(!force&&Math.abs(progress-this.progress)<10)return;
    this.progress=Math.max(0,progress);this.render();
  }
  upcoming(progress:number):RouteAlert|null {
    return this.alerts.filter(a=>a.at>=progress && a.start<=progress).sort((a,b)=>b.priority-a.priority || a.at-b.at)[0]??null;
  }
  clear():void {this.route=[];this.alerts=[];this.progress=0;this.render();}
  private render():void {(this.map.getSource(SOURCE) as GeoJSONSource|undefined)?.setData(routeAlertFeatures(this.route,this.alerts,this.progress));}
}
