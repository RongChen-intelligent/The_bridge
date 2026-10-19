import {statusLabels,type Feedback} from './shared';

function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function timestamp(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value)&&!Number.isNaN(new Date(value).getTime());}
function validFeedback(value:unknown):value is Feedback{
 if(!object(value)||typeof value.id!=='string'||!value.id||typeof value.title!=='string'||typeof value.content!=='string'||typeof value.category!=='string'||typeof value.reply!=='string'||typeof value.status!=='string'||!Object.hasOwn(statusLabels,value.status)||!Number.isSafeInteger(value.version)||!timestamp(value.created_at)||!timestamp(value.updated_at))return false;
 return value.messages===undefined||(Array.isArray(value.messages)&&value.messages.every(m=>object(m)&&typeof m.id==='string'&&(m.role==='student'||m.role==='staff')&&typeof m.content==='string'&&timestamp(m.created_at)));
}

// A TypeScript generic cannot validate JSON received from an older deployment.
// In the original API, GET staff?id=... still returns the whole inbox array.
export function readFeedbackResponse(response:unknown,expectedId?:string):Feedback{
 const feedback=object(response)?response.feedback:undefined;
 if(Array.isArray(feedback))throw new Error('后台来信接口版本尚未更新。请维护者部署最新的 bridge-api 云函数，并确认正式网址调用该版本后再刷新。');
 if(!validFeedback(feedback)||(expectedId!==undefined&&feedback.id!==expectedId))throw new Error('来信详情返回格式异常，暂时无法打开。请刷新重试；若仍失败，请联系网站维护者。');
 return feedback;
}
