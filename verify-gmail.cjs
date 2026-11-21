const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'desknote-gmail-'));
process.env.DESKNOTE_DATA_DIR=temp;
const G=require('./gmail-reader');const {Store}=require('./store');const {ReviewEngine}=require('./review-engine');
const raw=(id,date)=>({id,threadId:'thread-'+id,internalDate:String(date),snippet:'Snippet',payload:{headers:[{name:'Subject',value:'Return Nihongo Dekiru'},{name:'From',value:'library@fpt.edu.vn'}],parts:[{mimeType:'text/plain',body:{data:Buffer.from('Return by 20 November.').toString('base64url')}}]}});
(async()=>{
  const clientFile=path.join(temp,'client.json');fs.writeFileSync(clientFile,JSON.stringify({installed:{client_id:'test-client',client_secret:'test-secret'}}));
  let saved,oauthUrl;
  const connected=await G.authorize(clientFile,{save:a=>saved=a,open:async url=>{
    oauthUrl=new URL(url);assert.equal(oauthUrl.searchParams.get('scope'),G.SCOPE);
    const callback=new URL(oauthUrl.searchParams.get('redirect_uri'));callback.search=new URLSearchParams({code:'test-code',state:'wrong'}).toString();
    assert.equal((await fetch(callback)).status,400);
    callback.searchParams.set('state',oauthUrl.searchParams.get('state'));assert.equal((await fetch(callback)).status,200);
  },fetcher:async(url,init)=>{
    assert.equal(url,'https://oauth2.googleapis.com/token');
    assert.equal(init.body.get('grant_type'),'authorization_code');assert.equal(init.body.get('code'),'test-code');
    assert.equal(require('crypto').createHash('sha256').update(init.body.get('code_verifier')).digest('base64url'),oauthUrl.searchParams.get('code_challenge'));
    return {ok:true,json:async()=>({access_token:'temporary',refresh_token:'refresh',scope:G.SCOPE})};
  }});
  assert.equal(connected.connected,true);assert.equal(saved.refresh_token,'refresh');assert(!JSON.stringify(saved).includes('temporary'));
  if(process.platform==='win32'){
    G.saveAccount(saved);assert.deepEqual(G.loadAccount(),saved);assert(!fs.readFileSync(path.join(temp,'gmail-account.dpapi')).includes('refresh'));
  }
  await assert.rejects(()=>G.authorize(clientFile,{timeoutMs:20,open:()=>{}}),/timed out/);
  const calls=[];const api=async endpoint=>{calls.push(endpoint);if(endpoint.startsWith('messages?'))return {messages:[{id:'a'},{id:'b'}]};return endpoint.includes('/a?')?raw('a',1500):raw('b',2500);};
  const result=await G.readGmail(1000,2000,20,{api});
  assert.equal(result.messages.length,1);assert.equal(result.messages[0].id,'a');assert.match(result.messages[0].text,/Return by 20 November/);assert.equal(result.throughMs,2000);
  assert.match(decodeURIComponent(calls[0]),/-category:promotions/);assert(calls.every(c=>c.startsWith('messages?')||/\?format=full$/.test(c)));
  const partial=await G.readGmail(1000,2000,1,{api:async endpoint=>endpoint.startsWith('messages?')?{messages:[{id:'a'}],nextPageToken:'more'}:raw('a',1500)});
  assert.equal(partial.truncated,true);assert.equal(partial.throughMs,1000);
  assert.equal(G.message({...raw('html',1000),payload:{mimeType:'text/html',body:{data:'ignored'}}}).text,'Subject: \nSnippet');
  await assert.rejects(()=>G.readGmail(0,8*86400000),/seven days/);await assert.rejects(()=>G.searchGmail('',20),/query/);
  await assert.rejects(()=>G.searchGmail('library',20,{load:()=>saved,fetcher:async()=>({ok:false,status:401})}),/authorization failed/);
  const store=new Store(temp);const data=store.ensure();
  const engine=new ReviewEngine(store,{model:{},clock:()=>2000});
  const m={...result.messages[0],key:'gmail:a'};
  engine.apply({reply:'Book return task',operations:[{command:'add',fieldsJson:JSON.stringify({title:'Return library book',catId:data.categories[0].id,sourceKeys:['gmail:a']})}]},data,[m],2000);
  assert.equal(store.read().tasks.find(t=>t.title==='Return library book').sourceRefs[0].source,'gmail');
  const {Client}=require('@modelcontextprotocol/sdk/client/index.js');const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
  const client=new Client({name:'gmail-test',version:'1'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(__dirname,'inbox-mcp.js')],env:{...process.env,DESKNOTE_DATA_DIR:path.join(temp,'unconfigured')},stderr:'pipe'}));
    const {tools}=await client.listTools();assert(tools.some(t=>t.name==='search_gmail'));assert(tools.some(t=>t.name==='read_gmail_inbox'));
    assert(tools.every(t=>t.annotations.readOnlyHint));assert(!tools.some(t=>/send|delete|modify/.test(t.name)));
    const response=await client.callTool({name:'search_gmail',arguments:{query:'Nihongo'}});assert.equal(response.isError,true);assert.match(response.content[0].text,/not connected/);
  }finally{await client.close();}
  console.log('PASS: Gmail OAuth state/PKCE, timeout, Windows credential encryption, read-only MCP, bounded retrieval, source references, API failure and safe cursors. No real Gmail requests or AGY calls.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(temp,{recursive:true,force:true}));
