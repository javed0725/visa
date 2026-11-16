const test=require('node:test'), assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function relay() {
  const store={}, calls=[];
  let deliveries={success:true,otp:'123456',messageId:'11111111-1111-4111-8111-111111111111'};
  const context=vm.createContext({
    URL,AbortController,setTimeout,clearTimeout,
    chrome:{
      permissions:{async contains(){return true;}},
      storage:{local:{async get(){return store;},async set(value){Object.assign(store,value);}}}
    },
    async fetch(url, options) {
      calls.push({url,options});
      const data=url.endsWith('/pairings')?{
        clientKey:'ABCD-EFGH',browserToken:'test-only-browser-token',pairExpiresAt:Date.now()+600000,expiresAt:Date.now()+86400000
      }:url.includes('/messages/wait')?{success:true,otp:'654321',messageId:'22222222-2222-4222-8222-222222222222'}:
        url.includes('/messages')?deliveries:options.method==='GET'?{paired:true,enabled:!!store.phoneOTP?.enabled}:{};
      return {status:options.method==='DELETE'?204:200,ok:true,async json(){return data;}};
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../phone-relay.js'),'utf8'),context);
  return {store,calls,run:code=>vm.runInContext(code,context),setDelivery:value=>{deliveries=value;}};
}
test('relay requires HTTPS origin with no credentials or path',()=>{
  const r=relay();
  for(const value of ['http://example.com','https://user:pass@example.com','https://example.com/api','https://example.com/?key=x'])
    assert.throws(()=>r.run(`PhoneRelay.origin(${JSON.stringify(value)})`));
});
test('public pairing state never exposes browser credentials',async()=>{
  const r=relay();const state=await r.run(`PhoneRelay.configure('https://relay.test')`);
  assert.equal(state.clientKey,'ABCD-EFGH');
  assert.equal('browserToken' in state,false);assert.equal(state.enabled,false);
  assert.equal(r.store.phoneOTP.browserToken,'test-only-browser-token');
});
test('disabled phone auto-fill makes no OTP network request',async()=>{
  const r=relay();await r.run(`PhoneRelay.configure('https://relay.test')`);r.calls.length=0;
  assert.equal((await r.run('PhoneRelay.fetchOTP()')).success,false);
  assert.equal(r.calls.length,0);
});
test('regenerating revokes the old pairing before creating a new one',async()=>{
  const r=relay();await r.run(`PhoneRelay.configure('https://relay.test')`);r.calls.length=0;
  await r.run('PhoneRelay.regenerate()');
  assert.equal(r.calls[0].options.method,'DELETE');
  assert.equal(r.calls[1].options.method,'POST');
});
test('only submitted message receipts are suppressed on subsequent fetches',async()=>{
  const r=relay();await r.run(`PhoneRelay.configure('https://relay.test');`);
  await r.run('PhoneRelay.enable(true)');
  assert.equal((await r.run('PhoneRelay.fetchOTP()')).success,true);
  await r.run(`PhoneRelay.ack('11111111-1111-4111-8111-111111111111')`);
  assert.equal((await r.run('PhoneRelay.fetchOTP()')).success,false);
  r.setDelivery({success:true,otp:'654321',messageId:'22222222-2222-4222-8222-222222222222'});
  assert.equal((await r.run('PhoneRelay.fetchOTP()')).success,true);
});
test('long-poll wait uses the last acknowledged message as cursor',async()=>{
  const r=relay();await r.run(`PhoneRelay.configure('https://relay.test');`);
  await r.run('PhoneRelay.enable(true)');
  await r.run(`PhoneRelay.ack('11111111-1111-4111-8111-111111111111')`);
  const result=await r.run('PhoneRelay.waitOTP()');
  assert.equal(result.otp,'654321');
  assert.match(r.calls.at(-1).url,/messages\/wait\?after=11111111-1111-4111-8111-111111111111/);
  assert.equal(r.calls.at(-1).options.signal.aborted,false);
});
test('a late OTP receipt after RESET cannot recreate storage',async()=>{
  const r=relay();
  await r.run(`PhoneRelay.ack('11111111-1111-4111-8111-111111111111')`);
  assert.deepEqual(r.store,{});
});
