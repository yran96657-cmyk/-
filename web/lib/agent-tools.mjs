import {z} from 'zod/v4';
import {id} from './schema.mjs';

export function addAgentTools(add,store){
 const object=shape=>z.object(shape).strict();
 const project={projectId:id},task={...project,taskId:z.string().uuid()},revision={expectedRevision:z.number().int().positive()};
 const runtime=()=>{if(!store?.agentTasks)throw Error('AGENT_RUNTIME_UNAVAILABLE');return store.agentTasks;};
 add('get_agent_capabilities','读取 Agent 连续任务的实际范围、后台执行和恢复能力；未配置的服务返回 enabled=false。',object({}),()=>store?.agentTasks?{...store.agentTasks.capabilities,modes:store.journalRuntime?.capabilities?.enabled?(store.layoutAssistant?['prepare','proof','layout']:['prepare','proof']):[],layoutModelConfigured:!!store.layoutAssistant,proofReady:!!store.journalRuntime?.capabilities?.enabled}:{enabled:false,reason:'需要独立服务器的期刊运行时'},true);
 add('start_agent_task','授权 Agent 连续完成结构检查、版式方案、参数预检、原子应用、PDF 校样和机器检查。正文与公式保持原样。mode=prepare 使用 170×240 双栏期刊规则识别首面、章节、图表并出校样，无需模型；mode=proof 只生成并检查校样。requestId 是必填幂等键；重试同一请求必须复用。返回任务，不阻塞等待。',object({...project,...revision,requestId:z.string().uuid(),goal:z.string().trim().min(1).max(1200),mode:z.enum(['prepare','layout','proof']).default('layout')}),a=>runtime().start(store,a));
 add('get_agent_task','读取本人任务的真实步骤、修改差异、校样、版本冲突及可执行下一步。不返回推理思维链。',object(task),a=>runtime().get(store,a),true);
 add('list_agent_tasks','列出当前工程或本人未归档工程最近的 Agent 任务；浏览器关闭、换设备或换 Agent 后可续接。',object({projectId:id.optional(),limit:z.number().int().min(1).max(50).default(10)}),a=>runtime().list(store,a),true);
 add('cancel_agent_task','停止后续步骤，保留已提交修改和校样记录。应用中的原子写入不会被强制打断；撤销修改用 undo_agent_task。',object(task),a=>runtime().cancel(store,a));
 add('resume_agent_task','从持久化检查点继续已停止或中断的任务。校验当前修订，不重复已完成的修改。版本冲突或要求有歧义时须新建任务。',object({...task,...revision}),a=>runtime().resume(store,a));
 add('review_agent_task','记录用户对当前校样的本轮审阅完成。必须绑定源修订和 PDF SHA；仅作编辑审阅记录，不代表正式发印批准，不由后台自动调用。',object({...task,...revision,pdfSha256:z.string().regex(/^[a-f0-9]{64}$/)}),a=>runtime().review(store,a));
 add('undo_agent_task','整体撤销本任务已应用的版式，产生新修订。后续有其他修改时拒绝覆盖。',object({...task,...revision}),a=>runtime().undo(store,a));
}
