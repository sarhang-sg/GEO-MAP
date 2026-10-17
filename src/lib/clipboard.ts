/** Explicit copy action with an older WebView fallback and focus restoration. */
export async function copyText(value:string):Promise<boolean> {
  try { await navigator.clipboard.writeText(value); return true; } catch { /* optional API */ }
  const focused=document.activeElement;
  const input=document.createElement("textarea"); input.value=value; input.readOnly=true;
  input.style.cssText="position:fixed;inset:0 auto auto 0;opacity:0;pointer-events:none";
  document.body.append(input);
  try { input.select(); input.setSelectionRange(0,value.length); return document.execCommand("copy"); }
  catch { return false; }
  finally { input.remove(); if(focused instanceof HTMLElement && focused.isConnected) focused.focus({preventScroll:true}); }
}
