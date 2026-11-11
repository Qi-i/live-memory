/**
 * Select a compact, stable set of original posters from the real archive.
 * The input is already sorted by the archive's chronology. Different shows
 * with any overlapping named artist never appear together in the feature.
 * We do not fabricate items or alter the underlying archive.
 */
export function curateFeaturedRecords<T extends {id:string;artists:string[]}>(
  records:readonly T[], hasPoster:(record:T)=>boolean, limit=5,
):T[]{
  if(!Number.isFinite(limit)||limit<=0)return [];
  const chosen:T[]=[];
  const seenArtists=new Set<string>();
  for(const record of records){
    if(!hasPoster(record))continue;
    const artistKeys=[...new Set(record.artists
      .map(name=>name.normalize("NFKC").trim().toLocaleLowerCase())
      .filter(Boolean))];
    // Records without known artists remain distinct instead of all collapsing
    // into an unhelpful single "unknown" group.
    const keys=artistKeys.length?artistKeys:[`unlisted:${record.id}`];
    if(keys.some(key=>seenArtists.has(key)))continue;
    chosen.push(record);
    for(const key of keys)seenArtists.add(key);
    if(chosen.length>=Math.max(0,Math.min(5,Math.floor(limit))))break;
  }
  return chosen;
}
