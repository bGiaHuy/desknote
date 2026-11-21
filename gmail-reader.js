const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto');
const {execFileSync,spawn}=require('child_process');
const {DATA_DIR}=require('./store');
const SCOPE='https://www.googleapis.com/auth/gmail.readonly';
const accountFile=()=>path.join(DATA_DIR,'gmail-account.dpapi');
function protect(text,decrypt=false){
  const script='Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::'+(decrypt?'Unprotect':'Protect')+'($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))';
  try{return Buffer.from(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:Buffer.from(text).toString('base64'),encoding:'utf8',windowsHide:true,timeout:15000,stdio:['pipe','pipe','pipe']}).trim(),'base64');}
  catch{throw Error('Cannot access the Windows-protected Gmail account. Connect again with desknote gmail.login CLIENT.json.');}
}
function saveAccount(account){
  fs.mkdirSync(DATA_DIR,{recursive:true});const file=accountFile(),tmp=file+'.tmp';
  fs.writeFileSync(tmp,protect(JSON.stringify(account)));fs.renameSync(tmp,file);
}
function loadAccount(){
  if(!fs.existsSync(accountFile()))throw Error('Gmail is not connected. Run desknote gmail.login CLIENT.json.');
  return JSON.parse(protect(fs.readFileSync(accountFile()),true).toString('utf8'));
}
async function tokenRequest(fields,fetcher=fetch){
  const res=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams(fields),signal:AbortSignal.timeout(20000)});
  if(!res.ok)throw Error('Google authorization failed ('+res.status+'). Reconnect Gmail; no credentials were changed.');
  const data=await res.json();if(!data.access_token)throw Error('Google did not return an access token.');
  if(data.scope&&!data.scope.split(' ').includes(SCOPE))throw Error('Gmail read-only permission was not granted.');
  return data;
}
async function authorize(clientFile,{open=url=>{
  const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'});child.on('error',()=>{});child.unref();
},save=saveAccount,fetcher=fetch,timeoutMs=180000}={}){
  const client=JSON.parse(fs.readFileSync(clientFile,'utf8').replace(/^\uFEFF/,'' )).installed;
  if(!client?.client_id||!client.client_secret)throw Error('Choose a Google OAuth Desktop app client JSON file.');
  const state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(32).toString('base64url');
  const server=http.createServer();let timer,redirect;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    redirect='http://127.0.0.1:'+server.address().port+'/oauth2callback';
    const code=await new Promise((resolve,reject)=>{
      let accepted=false;
      timer=setTimeout(()=>reject(Error('Google sign-in timed out. Run gmail.login again.')),timeoutMs);
      server.on('request',(req,res)=>{
        const url=new URL(req.url,redirect);
        if(req.method!=='GET'||url.pathname!=='/oauth2callback'||url.searchParams.get('state')!==state||accepted){res.writeHead(400);res.end('Invalid sign-in callback.');return;}
        accepted=true;
        if(url.searchParams.has('error')||!url.searchParams.get('code')){res.end('Gmail connection cancelled.');reject(Error('Google sign-in was cancelled.'));return;}
        res.end('Google consent received. You can close this tab and return to Desknote.');resolve(url.searchParams.get('code'));
      });
      const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search=new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
      Promise.resolve().then(()=>open(url.href)).catch(reject);
    });
    const tokens=await tokenRequest({client_id:client.client_id,client_secret:client.client_secret,code,code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'},fetcher);
    if(!tokens.refresh_token)throw Error('Google did not grant offline access. Connect again.');
    save({client_id:client.client_id,client_secret:client.client_secret,refresh_token:tokens.refresh_token});
    return {connected:true,scope:SCOPE};
  }finally{clearTimeout(timer);server.close();server.closeAllConnections();}
}
async function gmailApi({load=loadAccount,fetcher=fetch}={}){
  const a=load();const tokens=await tokenRequest({client_id:a.client_id,client_secret:a.client_secret,refresh_token:a.refresh_token,grant_type:'refresh_token'},fetcher);
  return async endpoint=>{
    const res=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/'+endpoint,{headers:{Authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(20000)});
    if(!res.ok)throw Error('Gmail read failed ('+res.status+'). Check consent and that Gmail API is enabled.');
    return res.json();
  };
}
function bodyText(part){
  if(part.mimeType==='text/plain'&&part.body?.data)return Buffer.from(part.body.data,'base64url').toString('utf8');
  return (part.parts||[]).map(bodyText).filter(Boolean).join('\n');
}
function message(raw){
  const header=name=>(raw.payload?.headers||[]).find(h=>h.name.toLowerCase()===name)?.value||'';
  return {source:'gmail',id:raw.id,threadId:raw.threadId,threadName:header('subject'),sender:header('from'),isSelf:false,timestamp:Number(raw.internalDate),text:('Subject: '+header('subject')+'\n'+(bodyText(raw.payload||{})||raw.snippet||'')).slice(0,12000),hasAttachment:JSON.stringify(raw.payload||{}).includes('attachmentId'),url:'https://mail.google.com/mail/u/0/#all/'+raw.threadId};
}
async function searchGmail(query,limit=20,{api,...options}={}){
  if(typeof query!=='string'||query.length>2000||!query.trim()||!Number.isInteger(limit)||limit<1||limit>500)throw Error('Gmail search needs a query and limit between 1 and 500.');
  api=api||await gmailApi(options);const messages=[];let pageToken;
  do{
    const params=new URLSearchParams({q:query,maxResults:String(Math.min(100,limit-messages.length)),...(pageToken?{pageToken}:{})});
    const page=await api('messages?'+params);
    for(const item of page.messages||[])messages.push(message(await api('messages/'+encodeURIComponent(item.id)+'?format=full')));
    pageToken=page.nextPageToken;
  }while(pageToken&&messages.length<limit);
  return {source:'gmail',connected:true,messages,truncated:!!pageToken};
}
async function readGmail(since,until,limit=500,options={}){
  if(!Number.isSafeInteger(since)||!Number.isSafeInteger(until)||since<0||until<since||until-since>7*86400000)throw Error('Gmail review window must be no more than seven days.');
  // A saturated newest-first page cannot safely advance an oldest-first review cursor.
  const result=await searchGmail('in:inbox -category:promotions -category:social after:'+Math.floor(since/1000)+' before:'+Math.ceil((until+1)/1000),limit,options);
  result.messages=result.messages.filter(m=>m.timestamp>since&&m.timestamp<=until).sort((a,b)=>a.timestamp-b.timestamp);
  return {...result,throughMs:result.truncated?since:until,coverage:'Inbox mail only; promotions/social excluded before retrieval. HTML-only mail uses its snippet; attachments are not downloaded.'};
}
async function run(command,args){
  if(command==='gmail.login'){if(args.length!==1)throw Error('Usage: desknote gmail.login CLIENT.json');return authorize(args[0]);}
  if(command==='gmail.status')return {configured:fs.existsSync(accountFile()),scope:SCOPE};
  if(command==='gmail.search')return searchGmail(args.join(' '));
  throw Error('Unknown Gmail command.');
}
module.exports={authorize,protect,loadAccount,saveAccount,searchGmail,readGmail,message,run,SCOPE};
