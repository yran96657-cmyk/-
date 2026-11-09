import {z} from 'zod/v4';
export function addApiModelTools(add,store){
 const obj=s=>z.object(s).strict(),broker=()=>{if(!store?.apiModels)throw Error('API_MODEL_NOT_CONFIGURED');return store.apiModels;};
 add('get_api_models','查询可用于连续排版的普通 API 模型及连接器在线状态，不返回密钥。',obj({}),()=>store?.apiModels?.status(store.owner)||{enabled:false,models:[]},true);
 add('poll_api_model_request','本机连接器心跳并领取本人模型推理请求。用于私有网络网关，不授予对其他用户数据的访问。',obj({workerId:z.string().uuid(),models:z.array(z.string().min(1).max(200)).min(1).max(8),busy:z.boolean().default(false)}),a=>broker().poll(store.owner,a));
 add('complete_api_model_request','连接器提交已领取的模型响应；只接受所属用户、工作进程和请求，重复提交幂等。',obj({workerId:z.string().uuid(),requestId:z.string().uuid(),response:z.record(z.string(),z.unknown()).optional(),error:z.boolean().optional()}),a=>broker().complete(store.owner,a));
}
