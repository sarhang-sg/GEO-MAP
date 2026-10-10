import type { Map as MapLibreMap } from "maplibre-gl";
import { LOCATION_STATE_EVENT, type LiveLocationController, type LocationState } from "./live-location-controller";
import type { MapCoordinatePicker } from "./map-coordinate-picker";
import type { Language } from "./types";
import { escapeText } from "./geo-format";
import { APPEARANCE_VALUES as VALID, DEFAULT_APPEARANCE, applyAppearance, readAppearance, saveAppearance, type AppearancePreferences as Preferences } from "./appearance-state";

const COPY = {
  ku: { title:"ڕووکار و کۆنترۆڵ", controls:"دوگمەکانی نەخشە", visible:"هەمیشە دیار", hideAuto:"شاردنەوەی خۆکار", close:"داخستن", font:"فۆنت", brand:"فۆنتی NAV KURD", system:"فۆنتی ئامێر", size:"قەبارەی نووسین", normal:"ئاسایی", large:"گەورەتر", color:"ڕەنگی گشتی", original:"ڕەنگی سەرەتایی", reset:"گەڕاندنەوەی ڕووکار بۆ سەرەتا", blue:"شین", teal:"سەوزی ئاوی", amber:"زەردی تۆخ", motion:"جووڵە", auto:"بەپێی ئامێر", reduced:"جووڵەی کەم", quality:"کوالێتی ڕەسمکردن", economy:"پاشەکەوتی وزە", sharp:"وردتر", help:"ڕێنمایی ماوس و کیبۆرد", mouse:"بۆ جووڵاندنی نەخشە ڕایبکێشە؛ بە سکڕۆڵ نزیک و دوور بکەوە. Ctrl و ڕاکێشان بۆ سووڕاندن؛ Shift و ڕاکێشان بۆ زوومی ناوچەیەک. کلیکی ڕاست یان دەستڕاگرتن بۆ هەڵبژاردنی مەبەست.", keys:["گەڕان","شوێنی من","گۆڕینی دۆخی نەخشە","نیشاندانی هەموو ناوچەکە","نزیک و دوورکردنەوە","ڕێنمایی"], acquiring:"گەڕان بۆ شوێنی تۆ…", approximate:"شوێنی نزیکەیی؛ وردی نزیکەی", denied:"دەستگەیشتن بە شوێن ڕەت کراوەتەوە. لە ڕێکخستنی براوسەر ڕێگەی پێ بدە.", unavailable:"شوێن نەدۆزرایەوە. کۆمپیوتەر GPSی مۆبایلی هۆتسپۆت بەکار ناهێنێت.", retry:"هەوڵدانەوە", stop:"ڕاگرتن", choose:"شوێن لە نەخشە هەڵبژێرە", chosen:"شوێنی هەڵبژێردراو؛ شوێنی پشتڕاستکراوەی GPS نییە.", satellite:"وێنەی سەتەلایت ڕاستەوخۆ نییە. بەروار و وردی بەپێی دابینکەر و ناوچە دەگۆڕێت؛ زوومی زیاتر وێنەی تازە دروست ناکات." },
  ar: { title:"المظهر والتحكم", controls:"أزرار الخريطة", visible:"ظاهرة دائماً", hideAuto:"إخفاء تلقائي", close:"إغلاق", font:"الخط", brand:"خط NAV KURD", system:"خط الجهاز", size:"حجم النص", normal:"عادي", large:"أكبر", color:"ألوان الواجهة", original:"الألوان الأصلية", reset:"استعادة المظهر الافتراضي", blue:"أزرق", teal:"فيروزي", amber:"كهرماني", motion:"الحركة", auto:"تلقائي حسب الجهاز", reduced:"حركة أقل", quality:"جودة العرض", economy:"توفير الطاقة", sharp:"تفاصيل أعلى", help:"الماوس ولوحة المفاتيح", mouse:"اسحب لتحريك الخريطة، ومرّر للتكبير والتصغير. Ctrl مع السحب للتدوير؛ Shift مع السحب لتكبير منطقة. انقر بزر الماوس الأيمن أو اضغط مطولاً لاختيار الوجهة.", keys:["بحث","موقعي","تبديل نمط الخريطة","عرض المنطقة","تكبير وتصغير","مساعدة"], acquiring:"جارٍ تحديد موقعك…", approximate:"موقع تقريبي؛ دقة نحو", denied:"تم رفض إذن الموقع. اسمح به من إعدادات المتصفح.", unavailable:"تعذر تحديد الموقع. اتصال نقطة الاتصال لا ينقل GPS الهاتف إلى الكمبيوتر.", retry:"حاول مجدداً", stop:"إيقاف", choose:"اختر موقعاً على الخريطة", chosen:"موقع اخترته يدوياً، وليس موقع GPS مؤكداً.", satellite:"صور الأقمار الصناعية ليست مباشرة. تاريخها ودقتها يختلفان حسب المزود والمنطقة؛ التكبير لا يضيف صوراً أحدث." },
  en: { title:"Appearance & controls", controls:"Map controls", visible:"Always visible", hideAuto:"Auto-hide", close:"Close", font:"Font", brand:"NAV KURD font", system:"Device font", size:"Text size", normal:"Standard", large:"Larger", color:"Interface colors", original:"Original colors", reset:"Reset appearance", blue:"Blue", teal:"Teal", amber:"Amber", motion:"Motion", auto:"Device adaptive", reduced:"Reduced motion", quality:"Rendering quality", economy:"Battery saver", sharp:"Sharper", help:"Mouse & keyboard", mouse:"Drag to pan; scroll to zoom. Ctrl + drag to rotate; Shift + drag to zoom to an area. Right-click or long-press to choose a destination.", keys:["Search","My location","Map mode","Fit region","Zoom","Help"], acquiring:"Finding your location…", approximate:"Approximate location; accuracy about", denied:"Location permission was denied. Allow it in your browser settings.", unavailable:"Location unavailable. A hotspot connection does not share the phone’s GPS with a computer.", retry:"Retry", stop:"Stop", choose:"Choose on map", chosen:"Manually selected point; not a verified GPS position.", satellite:"Satellite imagery is not live. Capture date and resolution vary by provider and area; zooming cannot create newer imagery." }
};

export function installNavigationPreferences(options:{map:MapLibreMap; shell:HTMLElement; location:LiveLocationController; picker:MapCoordinatePicker; getLanguage:()=>Language; setMessage:(text:string)=>void}):void {
  const {map,shell,location,picker,getLanguage,setMessage}=options;
  const preferences=readAppearance();
  const baselineRatio=map.getPixelRatio();
  let degraded=false;
  const apply=():void=>{
    applyAppearance(preferences);
    const ratio=preferences.quality==="economy" ? Math.min(1,baselineRatio) : preferences.quality==="sharp" ? Math.min(2,window.devicePixelRatio||1) : degraded ? Math.min(1,baselineRatio) : baselineRatio;
    if(map.getPixelRatio()!==ratio) map.setPixelRatio(ratio);
    shell.dataset.qualityPreference=preferences.quality;
    window.dispatchEvent(new CustomEvent("nav-kurd:appearance-change",{detail:{...preferences}}));
  };
  apply();
  document.addEventListener("nav-kurd:performance-mode",event=>{
    degraded=(event as CustomEvent<{degraded:boolean}>).detail.degraded;
    if(preferences.quality==="auto") apply();
  });
  const button=document.createElement("button");
  button.id="appearanceButton"; button.className="about-dialog__utility-button appearance-button"; button.type="button";
  button.innerHTML='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6m8 4v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span></span>';
  shell.querySelector(".about-dialog__utility-actions")?.prepend(button);
  const dialog=document.createElement("dialog");
  dialog.className="navigation-preferences"; dialog.setAttribute("aria-labelledby","navigationPreferencesTitle"); shell.append(dialog);
  const render=():void=>{
    const c=COPY[getLanguage()]; button.title=c.title; button.setAttribute("aria-label",c.title);
    button.querySelector("span")!.textContent=c.title;
    dialog.dir=getLanguage()==="en"?"ltr":"rtl";
    const select=(key:keyof Preferences,label:string,entries:Array<[string,string]>)=>`<label><span>${escapeText(label)}</span><select data-preference="${key}">${entries.map(([value,text])=>`<option value="${value}" ${preferences[key]===value?"selected":""}>${escapeText(text)}</option>`).join("")}</select></label>`;
    dialog.innerHTML=`<header><h2 id="navigationPreferencesTitle">${escapeText(c.title)}</h2><button type="button" data-close>${escapeText(c.close)}</button></header><div class="navigation-preferences__fields">${select("font",c.font,[["brand",c.brand],["system",c.system]])}${select("size",c.size,[["normal",c.normal],["large",c.large]])}${select("accent",c.color,[["original",c.original],["blue",c.blue],["teal",c.teal],["amber",c.amber]])}${select("motion",c.motion,[["auto",c.auto],["reduced",c.reduced]])}${select("quality",c.quality,[["auto",c.auto],["economy",c.economy],["sharp",c.sharp]])}${select("controls",c.controls,[["visible",c.visible],["auto",c.hideAuto]])}</div><button type="button" class="navigation-preferences__reset" data-reset>${escapeText(c.reset)}</button><details open><summary>${escapeText(c.help)}</summary><p>${escapeText(c.mouse)}</p><dl>${["/ · Ctrl K","L","M","F","+ / −","?"].map((key,i)=>`<div><dt><kbd>${key}</kbd></dt><dd>${escapeText(c.keys[i])}</dd></div>`).join("")}</dl></details><p class="navigation-preferences__note">${escapeText(c.satellite)}</p>`;
    dialog.querySelector("[data-close]")?.addEventListener("click",()=>dialog.close());
    dialog.querySelector("[data-reset]")?.addEventListener("click",()=>{
      Object.assign(preferences,DEFAULT_APPEARANCE);saveAppearance(preferences);apply();render();
      dialog.querySelector<HTMLButtonElement>("[data-reset]")?.focus();
    });
  };
  const open=():void=>{previousFocus=document.activeElement as HTMLElement|null;render();if(!dialog.open)dialog.showModal();};
  button.addEventListener("click",open);
  let previousFocus:HTMLElement|null=null;
  dialog.addEventListener("close",()=>{
    const target=previousFocus?.getClientRects().length?previousFocus:document.getElementById("brandAboutButton");
    target?.focus({preventScroll:true});
  });
  dialog.addEventListener("change",event=>{
    const target=event.target as HTMLSelectElement;
    const key=target.dataset.preference as keyof Preferences;
    if(!key||!VALID[key]?.includes(target.value))return;
    Object.assign(preferences,{[key]:target.value});
    saveAppearance(preferences);
    apply();
  });
  const status=document.createElement("section");
  status.className="location-recovery";status.hidden=true;status.setAttribute("aria-live","polite");shell.append(status);
  let state:LocationState="idle",accuracy=0;
  const renderStatus=():void=>{
    const c=COPY[getLanguage()];status.hidden=state==="idle"||state==="ready";
    status.dir=getLanguage()==="en"?"ltr":"rtl";status.dataset.state=state;
    const text=state==="acquiring"?c.acquiring:state==="approximate"?`${c.approximate} ${Math.round(accuracy).toLocaleString()} m`:state==="denied"?c.denied:c.unavailable;
    status.innerHTML=`<p>${escapeText(text)}</p><div>${state!=="acquiring"?`<button type="button" data-location-retry>${escapeText(c.retry)}</button>`:""}<button type="button" data-location-stop>${escapeText(c.stop)}</button><button type="button" data-location-pick>${escapeText(c.choose)}</button></div>`;
  };
  document.addEventListener(LOCATION_STATE_EVENT,event=>{
    const detail=(event as CustomEvent<{state:LocationState;accuracy:number}>).detail;
    state=detail.state;accuracy=detail.accuracy;renderStatus();
  });
  status.addEventListener("click",event=>{
    const b=(event.target as Element).closest("button");if(!b)return;
    if(b.hasAttribute("data-location-retry")){location.stopTracking();location.locate();}
    else if(b.hasAttribute("data-location-stop"))location.stopTracking();
    else if(b.hasAttribute("data-location-pick")){
      location.stopTracking();
      picker.start(coordinate=>{map.easeTo({center:coordinate,zoom:Math.max(14,map.getZoom()),duration:350});setMessage(COPY[getLanguage()].chosen);},{body:COPY[getLanguage()].chosen});
    }
  });
  map.scrollZoom.setWheelZoomRate(1/550);
  window.addEventListener("keydown",event=>{
    if(event.defaultPrevented||event.isComposing||event.altKey)return;
    const target=event.target as HTMLElement|null;
    if(target?.closest("input,textarea,select,[contenteditable=true]"))return;
    if(dialog.open||[...document.querySelectorAll<HTMLElement>('dialog[open],[aria-modal="true"]')].some(el=>el.getClientRects().length>0))return;
    if(event.key==="Escape"&&location.state==="acquiring"){location.stopTracking();event.preventDefault();return;}
    if(event.ctrlKey||event.metaKey){if(event.key.toLowerCase()!=="k")return;event.preventDefault();document.getElementById("placeSearch")?.focus();return;}
    const ids:Record<string,string>={l:"locateButton",m:"mapModeCycleButton",f:"fitButton"};
    const key=event.key.toLowerCase();
    if(key==="/"){event.preventDefault();document.getElementById("placeSearch")?.focus();}
    else if(key==="?"){event.preventDefault();open();}
    else if(ids[key]){event.preventDefault();document.getElementById(ids[key])?.click();}
    else if((key==="+"||key==="="||key==="-")&&target!==map.getCanvas()){event.preventDefault();if(key==="-")map.zoomOut({duration:180});else map.zoomIn({duration:180});}
  });
  window.addEventListener("nav-kurd:language-change",()=>{render();renderStatus();});render();
}
