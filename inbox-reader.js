const fs=require('fs'),path=require('path');const {execFile}=require('child_process');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const configFile=path.join(require('./store').DATA_DIR,'inbox-local.json');
const localConfig=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')):{};
const EXCLUDED_ZALO=new Set(localConfig.excludedZaloThreads||[]);
function unpack(result){
  if(result.isError)throw Error(result.content?.find(x=>x.type==='text')?.text||'MCP read failed.');
  if(result.structuredContent)return result.structuredContent;
  return JSON.parse(result.content.find(x=>x.type==='text').text);
}
function readZalo(since,until,limit=500){
  const python=path.join(process.env.LOCALAPPDATA,'Programs','Python','Python312','python.exe');
  return new Promise((resolve,reject)=>execFile(python,[path.join(__dirname,'read-zalo-review.py'),String(since),String(until),String(limit)],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:4*1024*1024},(error,stdout)=>{
    if(error)return reject(Error('Could not read the Zalo archive. Check the listener and signed-in account.'));
    try{const data=JSON.parse(stdout);if(data.messages.some(m=>EXCLUDED_ZALO.has(m.threadId)))throw Error('Excluded Zalo chat returned.');resolve(data);}catch(error){reject(error);}
  }));
}
async function readMessenger(since,until,limit=500){
  const tokenFile=path.join(process.env.USERPROFILE||process.env.HOME,'.config','messenger-mcp','token.txt');
  const token=fs.readFileSync(tokenFile,'utf8').trim();
  const transport=new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8765/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}});
  const client=new Client({name:'desknote-readonly',version:'1.0.0'});
  try{
    await client.connect(transport);
    const status=unpack(await client.callTool({name:'status',arguments:{}},undefined,{timeout:15000}));
    let before;let messages=[];let complete=false;
    for(let page=0;page<8;page++){
      const result=unpack(await client.callTool({name:'get_messages',arguments:{limit:200,...(before?{before_timestamp_ms:before}:{})}},undefined,{timeout:15000}));
      const raw=result.messages||[];if(!raw.length){complete=true;break;}
      for(const m of raw)if(m.timestamp_ms>since&&m.timestamp_ms<=until&&!m.unsent)messages.push({source:'messenger',id:m.message_id,threadId:m.thread_id,threadName:m.thread_name||'',sender:m.sender_name||m.sender_id||'',isSelf:!!m.is_self,timestamp:m.timestamp_ms,text:m.text||'',hasAttachment:!!m.attachments?.length});
      const oldest=Math.min(...raw.map(m=>m.timestamp_ms));
      if(oldest<=since||raw.length<200){complete=true;break;}
      if(before&&oldest>=before)break;before=oldest;
    }
    messages=[...new Map(messages.map(m=>[m.id,m])).values()].sort((a,b)=>a.timestamp-b.timestamp||String(a.id).localeCompare(String(b.id)));
    const truncated=!complete||messages.length>limit;messages=messages.slice(0,limit);
    return {source:'messenger',messages,connected:status.state==='connected',connectionState:status.state,archiveCoverage:status.coverage,error:status.state==='connected'?undefined:(/no longer valid|login.php/.test(status.last_error||'')?'Messenger: Facebook session expired; sign in again in the existing Messenger MCP.':'Messenger listener is '+status.state),truncated,
      throughMs:status.state==='connected'?(truncated&&messages.length?messages.at(-1).timestamp-1:until):since,
      coverage:'Messenger only includes messages captured by its listener; complete server history is unavailable.'};
  }finally{await client.close().catch(()=>{});}
}
module.exports={EXCLUDED_ZALO,unpack,readZalo,readMessenger};
