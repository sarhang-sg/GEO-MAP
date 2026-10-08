import type { Language } from "./types";
export type ProviderStep = {distance?:number;name?:string;maneuver?:{type?:string;modifier?:string;exit?:number;location?:number[]}};
export type Maneuver = {atMeters:number;type:string;modifier:string;exit:number|null;name:string};
/** Retain provider maneuvers; never infer traffic restrictions from geometry. */
export function routeManeuvers(legs:readonly {steps?:ProviderStep[]}[]|undefined):Maneuver[] {
  let distance=0;
  const result:Maneuver[]=[];
  for(const leg of legs??[]) for(const step of leg.steps??[]) {
    const maneuver=step.maneuver;
    if(maneuver?.type && maneuver.type!=="depart") result.push({atMeters:distance,type:maneuver.type,modifier:maneuver.modifier??"straight",exit:Number.isInteger(maneuver.exit)&&maneuver.exit!>0?maneuver.exit!:null,name:typeof step.name==="string"?step.name.slice(0,160):""});
    distance+=Number.isFinite(step.distance)?Math.max(0,step.distance!):0;
  }
  return result;
}
export function nextManeuver(steps:readonly Maneuver[],progress:number):Maneuver|null {
  return steps.find(step=>step.atMeters>=Math.max(0,progress)-15)??null;
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
export function maneuverArrow(step:Maneuver):string {
  const path=step.type==="arrive"?"M8 28V5h17l-3 5 3 5H8":step.modifier==="uturn"?"M24 29V13a8 8 0 0 0-16 0v9m-5-5 5 5 5-5":step.type.includes("roundabout")||step.type==="rotary"?"M16 30v-7a9 9 0 1 1 9-9m-5-4 5 4 4-5":step.modifier.includes("left")?"M24 29V13H6m7-7-7 7 7 7":step.modifier.includes("right")?"M8 29V13h18m-7-7 7 7-7 7":"M16 29V4m-8 8 8-8 8 8";
  return `<svg viewBox="0 0 32 34" fill="none" aria-hidden="true"><path d="${path}" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
