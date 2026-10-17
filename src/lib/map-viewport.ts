/** CSS coordinates must not be divided by the physical device DPR. */
export function mapViewportSize(map: { getCanvas: () => Pick<HTMLCanvasElement,"width"|"height"|"style">; getPixelRatio: () => number }): { width:number; height:number } {
  const canvas=map.getCanvas(), ratio=Math.max(0.5,map.getPixelRatio()||1);
  // MapLibre writes CSS dimensions on resize, even when GPU limits clamp DPR.
  return {width:Math.max(1,parseFloat(canvas.style.width)||canvas.width/ratio),height:Math.max(1,parseFloat(canvas.style.height)||canvas.height/ratio)};
}
