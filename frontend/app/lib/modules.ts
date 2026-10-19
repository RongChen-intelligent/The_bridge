export const modules=[
 {path:'/signal',name:'THE SIGNAL',zh:'校园通知',en:'Campus updates',motto:'KEEP IN THE LOOP.',description:'The latest announcements, upcoming events and important campus updates.',chinese:'学生会公告、活动安排与重要提醒。在这里，及时读到与你有关的校园消息。'},
 {path:'/voice',name:'THE VOICE',zh:'学生信箱',en:'Student letters',motto:'YOUR THOUGHTS MATTER.',description:'A private space for your suggestions, concerns and ideas. One code keeps the conversation going.',chinese:'想法、建议，或希望改善的地方，都值得被认真听见。用一个查询码，连接每一次表达与回应。'},
 {path:'/common-ground',name:'THE COMMON GROUND',zh:'共同决定',en:'Campus polls',motto:'SHAPE IT TOGETHER.',description:'Take part in campus polls. Make your choice today and discover the results after voting closes.',chinese:'参与校园投票，表达你的偏好。每一份选择，都是共同塑造校园的一部分。'}
];
export type StaffUser={id:string;username:string;display_name:string;role:'owner'|'staff';must_change:number};
export type Attachment={id:string;name:string;type:string;size:number;data?:string;chunked?:boolean;chunks?:number;uploaded?:boolean};
export type Notice={id:string;title:string;content:string;state:'draft'|'published';created_at:number;updated_at:number;version:number;publish_at?:number;format?:'plain'|'markdown';align?:'left'|'center'|'right';text_size?:'small'|'normal'|'large'|'xlarge';attachments?:Attachment[]};
export type PollOption={id:string;label:string;votes?:number;percent?:number;rank?:number;image?:Attachment};
export type Poll={id:string;title:string;description:string;state:'open'|'closed';created_at:number;ends_at:number;options:PollOption[];total?:number;choice?:string;choices?:string[];max_choices?:number;version?:number;show_counts?:boolean;show_percent?:boolean;protection?:{accepted:number;blocked:number}};
