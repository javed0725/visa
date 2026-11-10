const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const base = 'http://localhost:80/api/phone-otp';
const sessions = [];
async function request(path, method='GET', token, body) {
  const response = await fetch(base+path, {
    method, headers: {'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  return {status:response.status, cache:response.headers.get('cache-control'),
    data:response.status===204?{}:await response.json()};
}
async function create() {
  const response=await request('/pairings','POST');
  assert.equal(response.status,201);
  assert.match(response.data.clientKey,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  sessions.push(response.data.browserToken);
  return response.data;
}
test('secure phone relay: pairing, isolation, delivery, pause, expiry and revocation', async t => {
  const browser=await create();
  let phone;
  const payload={clientKey:browser.clientKey,otp:'123456',messageId:randomUUID(),receivedAt:Date.now()};
  try {
    await t.test('client key binds one phone and is never a read credential', async () => {
      const paired=await request('/pair','POST',null,{clientKey:browser.clientKey});
      assert.equal(paired.status,200);phone=paired.data;
      assert.equal((await request('/pair','POST',null,{clientKey:browser.clientKey})).status,401);
      assert.equal((await request('/messages','GET',browser.clientKey)).status,401);
      assert.equal((await request('/messages','GET',phone.deviceToken)).status,401);
      assert.equal((await request('/messages','POST',browser.browserToken,payload)).status,401);
    });
    await t.test('a paired phone delivers six digits to its browser with no-cache headers', async () => {
      assert.equal((await request('/messages','POST',phone.deviceToken,payload)).status,202);
      const result=await request('/messages','GET',browser.browserToken);
      assert.equal(result.status,200);assert.equal(result.data.otp,payload.otp);
      assert.equal(result.data.messageId,payload.messageId);assert.match(result.cache,/no-store/);
    });
    await t.test('duplicate and older deliveries cannot replace the latest OTP', async () => {
      assert.equal((await request('/messages','POST',phone.deviceToken,{...payload,otp:'654321'})).status,202);
      assert.equal((await request('/messages','POST',phone.deviceToken,{...payload,otp:'654321',messageId:randomUUID(),receivedAt:payload.receivedAt-10000})).status,202);
      assert.equal((await request('/messages','GET',browser.browserToken)).data.otp,payload.otp);
    });
    await t.test('expired, invalid, ambiguous metadata and full SMS bodies are rejected', async () => {
      for (const change of [{otp:'12345'},{receivedAt:Date.now()-121000},{receivedAt:Date.now()+60000},
        {messageId:'invalid'},{smsBody:'not permitted'}]) {
        assert.equal((await request('/messages','POST',phone.deviceToken,{...payload,...change})).status,400);
      }
    });
    await t.test('separate pairings cannot write to each other', async () => {
      const second=await create();
      const paired=await request('/pair','POST',null,{clientKey:second.clientKey});
      assert.equal(paired.status,200);
      assert.equal((await request('/messages','POST',paired.data.deviceToken,payload)).status,401);
      assert.equal((await request('/messages','GET',second.browserToken)).data.success,false);
    });
    await t.test('turning off erases queued code and rejects SMS until enabled again', async () => {
      assert.equal((await request('/pairing','PATCH',browser.browserToken,{enabled:false})).status,200);
      assert.equal((await request('/messages','POST',phone.deviceToken,{...payload,messageId:randomUUID()})).status,409);
      assert.equal((await request('/messages','GET',browser.browserToken)).data.success,false);
      assert.equal((await request('/pairing','GET',phone.deviceToken)).data.enabled,false);
      assert.equal((await request('/pairing','PATCH',browser.browserToken,{enabled:true})).status,200);
      assert.equal((await request('/messages','GET',browser.browserToken)).data.success,false);
    });
    await t.test('unpair revokes both credentials immediately', async () => {
      assert.equal((await request('/pairing','DELETE',phone.deviceToken)).status,204);
      assert.equal((await request('/pairing','GET',browser.browserToken)).status,401);
      assert.equal((await request('/messages','POST',phone.deviceToken,payload)).status,401);
    });
  } finally {
    for (const token of sessions) await request('/pairing','DELETE',token);
  }
});
