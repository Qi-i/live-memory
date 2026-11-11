/** Original pixels are never modified. A bounded display crop is applied only
 * when the frame discards at most 24% of one dimension (12% on each side).
 * More extreme sources stay entirely visible over a blurred copy of themselves.
 */
export function visibleCropFraction(sourceRatio:number,frameRatio:number){
  if(!Number.isFinite(sourceRatio)||!Number.isFinite(frameRatio)||sourceRatio<=0||frameRatio<=0)return 1;
  return 1-Math.min(sourceRatio/frameRatio,frameRatio/sourceRatio);
}
export function posterDisplayMode(sourceRatio:number,frameRatio=2/3):"cover"|"backdrop"{
  return visibleCropFraction(sourceRatio,frameRatio)<=0.24?"cover":"backdrop";
}

/** Prefer the modal aspect ratio of the actual sources, rather than the
 * outlier-longest one. Bucket width 0.04 tolerates minor export differences.
 */
export function dominantPosterRatio(ratios:readonly number[],fallback=2/3){
  const portrait=ratios.filter(r=>Number.isFinite(r)&&r>=0.48&&r<=0.95);
  if(!portrait.length)return fallback;
  const bins=new Map<number,number[]>();
  for(const ratio of portrait){
    const key=Math.round(ratio/0.04);
    bins.set(key,[...(bins.get(key)||[]),ratio]);
  }
  const groups=[...bins.entries()].sort((a,b)=>b[1].length-a[1].length||
    Math.abs(a[0]*0.04-fallback)-Math.abs(b[0]*0.04-fallback));
  const group=groups[0][1].sort((a,b)=>a-b);
  return Math.min(0.82,Math.max(0.59,group[Math.floor(group.length/2)]));
}
