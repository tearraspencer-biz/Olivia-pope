import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { request as httpRequest } from 'node:http';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { mcpConfig, tokenVerifier } from '../dist/mcp/auth.js';
import { mcpTools } from '../dist/mcp/tools.js';
import { createMcpRouter } from '../dist/mcp/router.js';
const owner='10000000-0000-0000-0000-000000000001',client='20000000-0000-0000-0000-000000000001';
const documentId='meeting:30000000-0000-0000-0000-000000000001';
const config={resource:'https://mcp.example/mcp',authBase:'https://hq-db.example',issuer:'https://hq-db.example/auth/v1',ownerId:owner,clientIds:[client],publicKey:'public-test',knowledgeUrl:'https://olivia.example/functions/v1/knowledge-search',agentKey:'test-private-agent',oliviaDashboard:'https://olivia-dashboard.example',contentHqUrl:'https://content-hq.example',allowedOrigins:[]};
const keys=await generateKeyPair('ES256');const jwk=await exportJWK(keys.publicKey);jwk.kid='test';
const verify=tokenVerifier(config,createLocalJWKSet({keys:[jwk]}));
const sign=(override={})=>new SignJWT({role:'content_hq_mcp',client_id:client,...override}).setProtectedHeader({alg:'ES256',kid:'test'}).setIssuer(config.issuer).setAudience(config.resource).setSubject(owner).setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const document={id:documentId,title:'Personal coaching call',source_type:'meeting',source_path:'/meetings/30000000-0000-0000-0000-000000000001',coverage:'transcript_available',content:'A useful situation and its context.',next_offset:12000,total_chars:24000,private_names:['Private Participant']};

test('OAuth tokens must match the resource, owner, registered client and role',async()=>{
  await verify(await sign());
  for(const override of [{client_id:'unregistered'},{role:'anon'}]) await assert.rejects(verify(await sign(override)));
  for(const [aud,sub] of [['https://other.example/mcp',owner],[config.resource,'other-user']]) {
    const token=await new SignJWT({role:'authenticated',client_id:client}).setProtectedHeader({alg:'ES256',kid:'test'}).setIssuer(config.issuer).setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
    await assert.rejects(verify(token));
  }
  const expired=await new SignJWT({role:'authenticated',client_id:client}).setProtectedHeader({alg:'ES256',kid:'test'}).setIssuer(config.issuer).setAudience(config.resource).setSubject(owner).setIssuedAt(1).setExpirationTime(2).sign(keys.privateKey);
  await assert.rejects(verify(expired));
});
test('MCP stays disabled without configuration and rejects insecure endpoint configuration',()=>{
  assert.equal(mcpConfig({}),null);
  assert.throws(()=>mcpConfig({MCP_PUBLIC_URL:'http://example.com/mcp'}));
  assert.throws(()=>mcpConfig({MCP_PUBLIC_URL:'https://example.com/mcp',CONTENT_HQ_SUPABASE_URL:'https://db.example',OLIVIA_KNOWLEDGE_URL:config.knowledgeUrl}));
});
test('search and fetch use the existing search endpoint and never expose private keys or the names guard',async()=>{
  const calls=[];const tools=mcpTools(config,'hq-user-token',async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return json(calls.at(-1).body.action==='fetch'?{document}:{results:[document],search_modes:{originals:'keyword',lessons:'hybrid'}})});
  const result=await tools.search({query:'a personal situation'});assert.equal(calls[0].body.scope,'all');assert.equal(result.results[0].id,documentId);
  const read=await tools.fetch({id:documentId,offset:12000});assert.equal(calls[1].body.offset,12000);assert.equal(read.metadata.next_offset,12000);
  assert.doesNotMatch(JSON.stringify([result,read]),/test-private-agent|Private Participant/);
});
test('draft saves use the existing Content HQ RPC under the caller token, with source references only',async()=>{
  let saved;const tools=mcpTools(config,'hq-user-token',async(url,init)=>{
    if(url===config.knowledgeUrl)return json({document});
    assert.equal(url,config.authBase+'/rest/v1/rpc/save_mcp_content_draft');assert.equal(init.headers.Authorization,'Bearer hq-user-token');
    saved=JSON.parse(init.body);return json({record_id:'record',version_id:'version',approval_state:'Draft'});
  });
  const result=await tools.save({request_id:'request',engine_id:'engine',platform:'Facebook',title:'A new thought',copy:'Sometimes people feel exhausted. Give yourself a pause.',source_ids:[documentId],content_record_id:'record',parent_version_id:'prior',feedback:'Make it warmer'});
  assert.equal(result.approval_state,'Draft');assert.equal(saved.p_parent,'prior');assert.equal(saved.p_feedback,'Make it warmer');assert.equal(saved.p_context.knowledge.sources[0].id,documentId);
  assert.doesNotMatch(JSON.stringify(saved.p_context),/A useful situation|Private Participant|test-private-agent/);
});
test('video drafts require the existing Video Studio package format',async()=>{
  let writes=0;const tools=mcpTools(config,'token',async()=>{writes++;return json({record_id:'record',approval_state:'Draft'})});
  const args={request_id:'request',engine_id:'engine',platform:'Video',title:'A Reel',copy:'Unstructured script'};
  await assert.rejects(tools.save(args),/video package/);assert.equal(writes,0);
  const video={videoHook:'Start here',spokenScript:'A useful script.',teleprompter:'A useful script.',keyPoint:'A point',cta:'Save this',caption:'A caption',talkingPoints:['A point'],onScreenText:[],bRoll:[],platforms:['Facebook']};
  assert.equal((await tools.save({...args,copy:JSON.stringify(video)})).approval_state,'Draft');assert.equal(writes,1);
});
test('drafts naming a retrieved participant are blocked before any save',async()=>{
  let saved=false;const tools=mcpTools(config,'token',async(url)=>{if(url!==config.knowledgeUrl)saved=true;return json({document})});
  await assert.rejects(tools.save({request_id:'request',engine_id:'engine',platform:'Facebook',title:'A thought',copy:'Private Participant told me this.',source_ids:[documentId]}),/identifying/);assert.equal(saved,false);
});

test('resource-bound OAuth supports real MCP discovery using UserInfo, with owner/origin/host isolation',async()=>{
  const app=express();let remoteCalls=0;let userInfoOwner=owner;
  app.use(createMcpRouter(config,verify,async(url)=>{remoteCalls++;assert.equal(url,config.issuer+'/oauth/userinfo');return json({sub:userInfoOwner})}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(headers,body)=>new Promise((resolve,reject)=>{
    const req=httpRequest(base+'/mcp',{method:'POST',headers:{Host:'mcp.example',Accept:'application/json, text/event-stream','content-type':'application/json',...headers}},res=>{
      let text='';res.on('data',chunk=>{text+=chunk});res.on('end',()=>resolve({status:res.statusCode,headers:{get:name=>res.headers[name]},json:async()=>JSON.parse(text)}));
    });req.on('error',reject);req.end(JSON.stringify(body));
  });
  try{
    const meta=await fetch(base+'/.well-known/oauth-protected-resource/mcp');assert.equal((await meta.json()).resource,config.resource);
    const denied=await post({},{});assert.equal(denied.status,401);assert.match(denied.headers.get('www-authenticate'),/resource_metadata/);assert.equal(remoteCalls,0);
    const token=await sign();
    assert.equal((await post({Authorization:`Bearer ${token}`,Origin:'https://evil.example'},{})).status,403);
    assert.equal((await post({Authorization:`Bearer ${token}`,Host:'evil.example'},{})).status,403);
    const initialized=await post({Authorization:`Bearer ${token}`},{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'integration-test',version:'1'}}});
    assert.equal(initialized.status,200);assert.equal((await initialized.json()).result.serverInfo.name,'olivia-pope');
    const list=await post({Authorization:`Bearer ${token}`},{jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
    const tools=(await list.json()).result.tools;assert.deepEqual(tools.map(t=>t.name),['search','fetch','list_content_engines','save_content_draft']);
    assert.equal(tools.find(t=>t.name==='save_content_draft').annotations.readOnlyHint,false);
    assert.equal(tools.some(t=>/publish|approve|delete/.test(t.name)),false);
    userInfoOwner='unrelated-owner';
    assert.equal((await post({Authorization:`Bearer ${token}`},{jsonrpc:'2.0',id:3,method:'tools/list',params:{}})).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));server.closeAllConnections()}
});
