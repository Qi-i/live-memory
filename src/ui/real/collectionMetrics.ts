import type {EventRecord} from "../../domain";

export function groupByCity(records:readonly EventRecord[]){
  const groups=new Map<string,EventRecord[]>();
  for(const record of records){
    const city=record.city.trim()||"城市待补";
    groups.set(city,[...(groups.get(city)||[]),record]);
  }
  return [...groups.entries()].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0],"zh"));
}

export function groupByArtist(records:readonly EventRecord[]){
  const groups=new Map<string,EventRecord[]>();
  for(const record of records){
    for(const name of new Set(record.artists.map(x=>x.trim()).filter(Boolean))){
      groups.set(name,[...(groups.get(name)||[]),record]);
    }
  }
  return [...groups.entries()].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0],"zh"));
}

export function summarizeRecordedPrices(records:readonly EventRecord[]){
  const priced=records.filter(record=>typeof record.price==="number"&&Number.isFinite(record.price));
  return {
    total:priced.reduce((sum,row)=>sum+(row.price||0),0),
    count:priced.length,
    missing:records.length-priced.length,
  };
}

export function groupCalendarDays(records:readonly EventRecord[],month:string){
  const group=new Map<number,EventRecord[]>();
  if(!/^\d{4}-\d{2}$/.test(month))return group;
  const [year,number]=month.split("-").map(Number);
  const days=new Date(year,number,0).getDate();
  for(const record of records){
    if(!record.date.startsWith(month+"-"))continue;
    const day=Number(record.date.slice(8,10));
    if(day>=1&&day<=days)group.set(day,[...(group.get(day)||[]),record]);
  }
  return group;
}
