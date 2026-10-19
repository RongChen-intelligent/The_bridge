export const categories = ["学习与教学", "食堂与餐饮", "校园设施", "校园生活", "活动与社团", "其他建议"];
export const categoryEnglish: Record<string,string> = {"学习与教学":"Learning", "食堂与餐饮":"Dining", "校园设施":"Facilities", "校园生活":"Campus life", "活动与社团":"Clubs & activities", "其他建议":"Other ideas"};
export const statusLabels: Record<string, string> = { pending: "待回复 / Awaiting reply", processing: "处理中 / In progress", completed: "已回复 / Replied" };
export type LetterMessage={id:string;role:'student'|'staff';content:string;created_at:number};
export type Feedback = { first_reply_at?:number|null;expires_at?:number|null; id: string; title: string; category: string; content: string; status: string; reply: string; created_at: number; updated_at: number; version: number;messages?:LetterMessage[];student_count?:number;reply_count?:number };
export function threadMessages(f:Feedback):LetterMessage[]{return f.messages??[{id:'original',role:'student',content:f.content,created_at:f.created_at},...(f.reply?[{id:'legacy',role:'staff' as const,content:f.reply,created_at:f.updated_at}]:[])];}
export function localDateInput(value:number){const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function normalizeCode(value: string) { return value.replace(/[\s-]/g, "").toUpperCase(); }
export function validCode(value: string) { return /^[0-9A-F]{32}$/.test(normalizeCode(value)); }
export function formatCode(value: string) { return normalizeCode(value).match(/.{1,4}/g)?.join("-") ?? value; }
export function makeCode() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, "0")).join("").toUpperCase(); }
export function dateLabel(value: number) { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }).format(value)+" (UTC+8)"; }
