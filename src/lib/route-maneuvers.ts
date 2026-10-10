import type { Language } from "./types";
export type ProviderStep = {distance?:number;name?:string;maneuver?:{type?:string;modifier?:string;exit?:number;location?:number[]}};
export type Maneuver = {atMeters:number;type:string;modifier:string;exit:number|null;name:string;coordinate:[number,number]|null};
/** Retain provider maneuvers; never infer traffic restrictions from geometry. */
export function routeManeuvers(legs:readonly {steps?:ProviderStep[]}[]|undefined):Maneuver[] {
  let distance=0;
  const result:Maneuver[]=[];
  for(const leg of legs??[]) for(const step of leg.steps??[]) {
    const maneuver=step.maneuver;
    const location=maneuver?.location;
    const coordinate:[number,number]|null=location?.length===2&&location.every(Number.isFinite)?[location[0],location[1]]:null;
    if(maneuver?.type && maneuver.type!=="depart") result.push({atMeters:distance,type:maneuver.type,modifier:maneuver.modifier??"straight",exit:Number.isInteger(maneuver.exit)&&maneuver.exit!>0?maneuver.exit!:null,name:typeof step.name==="string"?step.name.slice(0,160):"",coordinate});
    distance+=Number.isFinite(step.distance)?Math.max(0,step.distance!):0;
  }
  return result;
}
export function nextManeuver(steps:readonly Maneuver[],progress:number):Maneuver|null {
  return steps.find(step=>step.atMeters>=Math.max(0,progress)-5)??null;
}
const COPY={
  ku:{straight:"بەردەوام بە",left:"بۆ چەپ بسووڕێوە",right:"بۆ ڕاست بسووڕێوە",uturn:"یووتێرن بکە",roundabout:"لە بازنەکە",exit:"دەرچوون",arrive:"گەیشتن بە مەبەست",merge:"بچۆ ناو ڕێگاکە"},
  ar:{straight:"تابع للأمام",left:"انعطف يساراً",right:"انعطف يميناً",uturn:"استدر للخلف",roundabout:"عند الدوار",exit:"المخرج",arrive:"الوصول إلى الوجهة",merge:"اندمج مع الطريق"},
  en:{straight:"Continue",left:"Turn left",right:"Turn right",uturn:"Make a U-turn",roundabout:"At the roundabout",exit:"exit",arrive:"Arrive at destination",merge:"Merge"}
};
export function maneuverLabel(step:Maneuver,language:Language):string {
  const c=COPY[language];
  if(step.type==="arrive")return c.arrive;
  if(step.type.includes("roundabout")||step.type==="rotary")return step.exit?`${c.roundabout} · ${c.exit} ${step.exit}`:c.roundabout;
  if(step.modifier==="uturn")return c.uturn;
  if(step.type==="merge")return c.merge;
  if(step.modifier.includes("left"))return c.left;
  if(step.modifier.includes("right"))return c.right;
  return c.straight;
}
