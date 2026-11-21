const path=require('path');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const {unpack}=require('./inbox-reader');
async function collectInboxes(cursors,until){
  const client=new Client({name:'desknote-review',version:'1.0.0'});
  const node=path.join(process.env.ProgramFiles||'C:/Program Files','nodejs','node.exe');
  const transport=new StdioClientTransport({command:node,args:[path.join(__dirname,'inbox-mcp.js')],stderr:'pipe'});
  try{
    await client.connect(transport);
    const results={};
    for(const source of ['zalo','messenger','gmail']){
      try{results[source]=unpack(await client.callTool({name:'read_'+source+'_inbox',arguments:{sinceMs:Math.max(cursors[source]||until-86400000,until-7*86400000),untilMs:until,limit:500}},undefined,{timeout:90000}));}
      catch(error){results[source]={source,messages:[],connected:false,error:error.message,throughMs:cursors[source]||until-86400000};}
    }
    return results;
  }finally{await client.close();}
}
module.exports={collectInboxes};
