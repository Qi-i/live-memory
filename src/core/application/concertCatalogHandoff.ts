import type {EventRecord} from "../../domain";

const allowedOrigins=new Set(["https://qiledger.pages.dev","http://localhost:3000","http://localhost:8080","http://localhost:5000"]);
export function readConcertCatalogRequest(search:string){
  const query=new URLSearchParams(search),target=query.get("origin")||"",request=query.get("request")||"";
  if(query.get("qiledger_bridge")!=="1"||!allowedOrigins.has(target)||!/^[A-Za-z0-9_-]{16,100}$/.test(request))return null;
  return {target,request};
}
export function createConcertCatalogReply(records:readonly EventRecord[],request:string){
  const events=records.filter(record=>record.category==="concert"&&!record.deletedAt)
    .map(record=>({id:record.id,title:record.title,date:record.date,city:record.city,venue:record.venue,
      category:record.category,facePrice:typeof record.price==="number"&&Number.isFinite(record.price)?record.price:null}))
    .sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  return {type:"live-memory:catalog:v1",request,events};
}
