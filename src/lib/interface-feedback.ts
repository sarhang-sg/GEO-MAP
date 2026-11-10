import type { Language } from "./types";
export function dayPhase(hour:number): "dawn"|"morning"|"afternoon"|"sunset"|"night" {
  return hour<5 || hour>=19 ? "night" : hour<7 ? "dawn" : hour<15 ? "morning" : hour<17 ? "afternoon" : "sunset";
}
const greetings={ku:["بەیانی باش","نیوەڕۆ باش","ئێوارە باش","شەو باش"],ar:["صباح الخير","طاب مساؤك","مساء الخير","طابت ليلتك"],en:["Good Morning","Good Afternoon","Good Evening","Good Night"]};
export function weatherClock(node:HTMLElement, timeZone:string):void {
  const hour=Number(new Intl.DateTimeFormat("en-GB",{hour:"2-digit",hourCycle:"h23",timeZone}).format(new Date()));
  node.dataset.skyPhase=dayPhase(hour);node.dataset.skyZone=timeZone;
  const phase=hour<5?0:hour<7?1:hour<10?2:hour<12?3:hour<15?4:hour<17?5:hour<19?6:7;
  const palette=[["#232675","#512979"],["#ff9475","#b899ff"],["#00d3fb","#ffdd4a"],["#00cfff","#ffe041"],["#04cbf4","#ffda32"],["#279bff","#ffb531"],["#ff7034","#c41c85"],["#29227a","#4e237f"]][phase];
  const month=Number(new Intl.DateTimeFormat("en",{timeZone,month:"numeric"}).format(Date.now()));
  const season=(Math.floor((month%12)/3)+(Number(node.dataset.latitude)<0?2:0))%4;
  const accents=["#89cfff","#60dfc5","#ffc42b","#ff985e"];
  const dust=Number(node.dataset.dust)>=150, code=Number(node.dataset.wmo);
  const tint=code>=95?"#6953c9":code>=71&&code<=77||code>=85&&code<=86?"#b6f3ff":code>=51?"#337bce":code>=45?"#abc8d4":code>0?"#a7bdf3":palette[0];
  node.style.setProperty("--weather-start",dust?"#edbe7c":`color-mix(in srgb,${palette[0]} 83%,${tint})`);
  node.style.setProperty("--weather-end",dust?"#df742e":`color-mix(in srgb,${palette[1]} 88%,${accents[season]})`);
  const heat=Math.max(0,Math.min(100,((Number(node.dataset.temp)||0)+15)/65*100));
  node.style.setProperty("--weather-glow",`color-mix(in srgb,#ff9361 ${heat}%,#799bff)`);
}
let lastPulse=-Infinity;
export function tactile(kind:"tap"|"scroll"|"search"):void {
  if(document.hidden || navigator.userActivation && !navigator.userActivation.hasBeenActive || document.body.dataset.motionPreference==="reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  const now=performance.now();if(now-lastPulse<(kind==="scroll"?180:65))return;lastPulse=now;
  if(window.flutter_inappwebview) void window.flutter_inappwebview.callHandler("navKurdHaptic",{kind}).catch(()=>undefined);
  else navigator.vibrate?.(kind==="scroll"?4:kind==="search"?10:7);
}
export function installInterfaceFeedback(language:()=>Language):void {
  let timer=0;
  const update=()=>{
    window.clearTimeout(timer);if(document.hidden)return;
    const now=new Date(),hour=now.getHours(),node=document.getElementById("homeGreeting");
    if(node)node.textContent=greetings[language()][hour>=5&&hour<12?0:hour>=12&&hour<17?1:hour>=17&&hour<20?2:3];
    document.querySelectorAll<HTMLElement>("[data-sky-zone]").forEach(el=>weatherClock(el,el.dataset.skyZone!));
    timer=window.setTimeout(update,60000-now.getSeconds()*1000-now.getMilliseconds()+30);
  };
  update();document.addEventListener("visibilitychange",update);window.addEventListener("nav-kurd:language-change",update);
  document.addEventListener("click",e=>{if(e.isTrusted && e.target instanceof Element && e.target.closest("button:not(:disabled),[role=button]")) tactile("tap");},{capture:true,passive:true});
  const positions=new WeakMap<Element,number>();
  document.addEventListener("scroll",e=>{
    const el=e.target;
    if(!(el instanceof HTMLElement) || !el.matches("[role=listbox],[role=list],.user-contrib__body,.owner-studio__body,.about-dialog__panel"))return;
    if(Math.abs(el.scrollTop-(positions.get(el)??0))>=64){positions.set(el,el.scrollTop);tactile("scroll");}
  },{capture:true,passive:true});
}
