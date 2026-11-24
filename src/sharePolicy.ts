export function reconcileSelection<T extends {id:string}>(previous:ReadonlySet<string>, records:readonly T[]) {
  return new Set(records.filter(record=>previous.has(record.id)).map(record=>record.id));
}
export function preservePoster(frameRatio:number,posterRatio:number) {
  return frameRatio > .86 || Math.abs(Math.log(Math.max(.01,frameRatio)/Math.max(.01,posterRatio))) > .10;
}
export function assertShareCanvas(width:number,height:number) {
  if(width>8192||height>16384||width*height>32_000_000)
    throw new Error("画布过大，请缩小选取范围或按年份分批导出。");
}
export function chronologicalGroups<T extends {date:string}>(records:readonly T[], monthly:boolean) {
  const groups=new Map<string,T[]>();
  for(const record of records) {
    const key=record.date.slice(0,monthly?7:4)||"未定";
    const list=groups.get(key)||[];
    list.push(record);groups.set(key,list);
  }
  return Array.from(groups,([label,records])=>({label,records}));
}

/** Keep each month readable, then allocate remaining space by poster rows. */
export function timelineBandHeights(counts:readonly number[], availableHeight:number,gap:number) {
  if(!counts.length)return [];
  const total=Math.max(0,availableHeight-gap*(counts.length-1));
  const weights=counts.map(count=>84+Math.ceil(Math.max(1,count)/3)*300);
  const sum=weights.reduce((a,b)=>a+b,0);
  return weights.map(weight=>total*weight/sum);
}
