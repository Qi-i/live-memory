import type {EventRecord} from "../../domain";

/** QiHub/contracts/concert-reminders.v1.schema.json is the canonical contract. */
export interface ConcertReminderRow {
  id:string;title:string;date:string;time:string;city:string;venue:string;
  seat:string;timeZone:"Asia/Shanghai"|"device-local";
  status:EventRecord["status"];recordState:EventRecord["recordState"];
  updatedAt:string;deletedAt:string|null;
}
export interface ConcertReminderHandoff {
  schemaVersion:1;sourceApp:"live-memory";purpose:"concert-reminders";
  generatedAt:string;records:ConcertReminderRow[];
}
const chinaCities=new Set([
  "北京","上海","天津","重庆","广州","深圳","成都","杭州","南京","武汉",
  "西安","苏州","长沙","青岛","郑州","福州","厦门","合肥","济南","沈阳",
  "大连","哈尔滨","长春","石家庄","太原","南昌","昆明","南宁","贵阳",
  "兰州","西宁","银川","乌鲁木齐","呼和浩特","拉萨","海口","三亚",
  "东莞","佛山","珠海","无锡","宁波","常州","南通","徐州","洛阳",
  "泉州","温州","金华","嘉兴","绍兴","台州","秦皇岛","保定","唐山",
  "吉林","延吉","扬州","盐城","泰州","淮安","宿迁","绵阳","德阳",
  "乐山","宜宾","泸州","遵义","柳州","桂林","烟台","威海","潍坊",
  "临沂","淄博","东营","泰安","济宁","菏泽","聊城","德州","滨州",
  "香港","澳门","台北","高雄"
]);
function knownChinaTimeZone(city:string):boolean{
  const compact=city.replace(/\s/g,"").replace(/(?:市|特别行政区)$/,"");
  return chinaCities.has(compact);
}
const validDate=(value:string)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+"T00:00:00.000Z");
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
};
const validTime=(value:string)=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const validStamp=(value:string)=>!Number.isNaN(Date.parse(value));

/** Only an explicit subset of private records crosses the application boundary. */
export function createConcertReminderHandoff(
  source:EventRecord[],generatedAt=new Date().toISOString(),
):ConcertReminderHandoff{
  if(!validStamp(generatedAt))throw Error("REMINDER_EXPORT_INVALID_TIME");
  if(source.length>5000)throw Error("REMINDER_EXPORT_TOO_MANY_RECORDS");
  const seen=new Set<string>();
  const rows:ConcertReminderRow[]=source.map(record=>{
    if(!record.id.trim()||record.id.length>128||!record.title.trim()||record.title.length>500||
      (record.city||"").length>120||(record.venue||"").length>250||(record.seat||"").length>250||
      !["planned","watched","wish"].includes(record.status)||
      !["normal","rescheduled","cancelled","refunded"].includes(record.recordState)||
      !validDate(record.date)||!validStamp(record.updatedAt)||record.updatedAt.length>64||
      (record.deletedAt&&!validStamp(record.deletedAt))||seen.has(record.id)){
      throw Error("REMINDER_EXPORT_INVALID_RECORD");
    }
    seen.add(record.id);
    const timeZone:ConcertReminderRow["timeZone"]=
      knownChinaTimeZone(record.city)?"Asia/Shanghai":"device-local";
    return {
      id:record.id,title:record.title,date:record.date,
      time:validTime(record.time||"")?record.time!:"",
      city:record.city||"",venue:record.venue||"",seat:record.seat||"",
      timeZone,
      status:record.status,recordState:record.recordState,
      updatedAt:record.updatedAt,deletedAt:record.deletedAt||null,
    };
  }).sort((a,b)=>a.id.localeCompare(b.id));
  const result:ConcertReminderHandoff={schemaVersion:1,sourceApp:"live-memory",purpose:"concert-reminders",
    generatedAt,records:rows};
  if(new TextEncoder().encode(JSON.stringify(result)).length>3*1024*1024)throw Error("REMINDER_EXPORT_TOO_LARGE");
  return result;
}
