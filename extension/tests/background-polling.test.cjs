const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('concurrent authorized OTP reads share one network request instead of triggering retry backoff', async () => {
  let listener, release, reads = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const context = vm.createContext({
    URL, console, importScripts() {},
    PhoneRelay: { async fetchOTP() { reads++; return pending; } },
    chrome: {
      action: { onClicked: { addListener() {} } },
      runtime: {
        getURL: file => 'chrome-extension://test/' + file,
        onMessage: { addListener(fn) { listener = fn; } }
      }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), context);
  const sender = { tab: { active: true, url: 'https://appointment.ivacbd.com/' } };
  const send = () => new Promise(resolve => listener({ type: 'FETCH_OTP' }, sender, resolve));
  const a = send(), b = send();
  assert.equal(reads, 1);
  release({ success: true, otp: '027922' });
  const results = await Promise.all([a, b]);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].data.otp, '027922');
  await send();
  assert.equal(reads, 2);
});
