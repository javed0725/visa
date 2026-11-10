const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('RESET fences queued phone actions and late receipts leave storage empty',async()=>{
  let listener,release,started;
  const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  const store={phoneOTP:{relayURL:'https://relay.test',browserToken:'test-only-token',enabled:true}};
  const context=vm.createContext({
    URL,AbortController,setTimeout,clearTimeout,console,importScripts(){},
    chrome:{
      action:{onClicked:{addListener(){}}},
      runtime:{getURL:file=>'chrome-extension://test/'+file,onMessage:{addListener(fn){listener=fn;}}},
      permissions:{async contains(){return true;}},
      storage:{local:{async get(){return {...store};},async set(value){Object.assign(store,value);},async clear(){for(const key of Object.keys(store))delete store[key];}}},
      tabs:{async query(){return [{id:1}];},async sendMessage(){}}
    },
    async fetch() {started();await gate;return {status:204,ok:true};}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../phone-relay.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),context);
  const sender={tab:{url:'https://appointment.ivacbd.com/',active:true}};
  const send=message=>new Promise(resolve=>listener(message,sender,resolve));
  const reset=send({type:'RESET_AUTOMATOR'});
  await ready;
  const during=await send({type:'PHONE_ACK_OTP',messageId:'11111111-1111-4111-8111-111111111111'});
  assert.equal(during.ok,false);
  release();assert.equal((await reset).ok,true);
  assert.deepEqual(store,{});
  await send({type:'PHONE_ACK_OTP',messageId:'11111111-1111-4111-8111-111111111111'});
  assert.deepEqual(store,{});
});
