const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extensionDir = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const source = fs.readFileSync(path.join(extensionDir, 'content.js'), 'utf8');

test('Black Panther manifest loads its scoped panel theme', () => {
  assert.equal(manifest.name, 'BLACK PANTHER — SLOT AUTOMATION');
  assert.ok(manifest.content_scripts[0].css.includes('black-panther.css'));
  assert.ok(fs.existsSync(path.join(extensionDir, 'black-panther.css')));
});

test('panel contains the roadmap, all four sections, metrics, and four document slots', () => {
  for (const section of ['RUN', 'CONFIG', 'LOG', 'DEBUG']) assert.ok(source.includes(section));
  for (const step of ['LOGIN', 'OTP', 'LANDING', 'NOTICE', 'UPLOAD', 'CO', 'MISSION', 'CENTER', 'DATE', 'PAY']) {
    assert.ok(source.includes(`label: '${step}'`), `missing ${step} roadmap step`);
  }
  for (const metric of ['metric-attempts', 'metric-cycle', 'metric-dates', 'metric-next',
    'metric-stage', 'metric-preferred', 'metric-available', 'metric-trying']) {
    assert.ok(source.includes(`id="${metric}"`), `missing ${metric} telemetry`);
  }
  for (const slot of ['PRIMARY PDF', 'CO1', 'CO2', 'CO3']) assert.ok(source.includes(slot));
});

test('payment remains manual and no PIN field or auto-payment control is added', () => {
  assert.match(source, /Payment remains manual on the official page/);
  assert.match(source, /does not collect or store a bKash PIN/);
  assert.doesNotMatch(source, /id=["'][^"']*(?:pin|payment-submit|auto-pay)[^"']*["']/i);
});

test('automation settings clamp scan, backoff, month, and date-order values', () => {
  const context = vm.createContext({
    window: { location: { href: 'https://test.invalid/', hostname: 'test.invalid', pathname: '/' } },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, body: {} },
    chrome: { storage: { local: { set() {} } } },
    console, setTimeout, clearTimeout, Event
  });
  vm.runInContext(source, context);
  assert.equal(vm.runInContext('normalizeAutomationSettings({scanGapMs: 90000}).scanGapMs', context), 30000);
  assert.equal(vm.runInContext('normalizeAutomationSettings({rate429BackoffMs: 1}).rate429BackoffMs', context), 1000);
  assert.equal(vm.runInContext('normalizeAutomationSettings({monthRange: 99}).monthRange', context), 12);
  assert.equal(vm.runInContext('normalizeAutomationSettings({slotRotation: "unknown"}).slotRotation', context), 'middle');
});

test('manual navigation toggle prevents automated site clicks', () => {
  const context = vm.createContext({
    window: { location: { href: 'https://test.invalid/', hostname: 'test.invalid', pathname: '/' } },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, body: {} },
    chrome: { storage: { local: { set() {} } } },
    console, setTimeout, clearTimeout, Event
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    var clickCount = 0;
    first = () => null;
    busy = () => false;
    captchaPending = () => false;
    click = () => { clickCount++; return true; };
    updateStage = () => {};
    automationSettings.autoNavigate = false;
    var step = {kind:'appointment',root:{},nextTry:0,tries:0};
    submitStep(step, {});
  `, context);
  assert.equal(vm.runInContext('clickCount', context), 0);
});

test('disabled auto-upload setting does not attach a file or advance', () => {
  const context = vm.createContext({
    window: { location: { href: 'https://test.invalid/', hostname: 'test.invalid', pathname: '/' } },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, body: {} },
    chrome: { storage: { local: { set() {} } } },
    console, setTimeout, clearTimeout, Event
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    updateStage = () => {};
    fileInputs = () => { throw new Error('upload scan should not run'); };
    automationSettings.autoUploadPdf = false;
    var step = {kind:'upload',root:{}};
    performUploads(step);
  `, context);
  assert.equal(vm.runInContext('step.uploadRecords', context), undefined);
});

test('auto-submit OTP toggle refuses to click Verify', () => {
  const context = vm.createContext({
    window: { location: { href: 'https://test.invalid/', hostname: 'test.invalid', pathname: '/' } },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, body: {} },
    chrome: { storage: { local: { set() {} } } },
    console, setTimeout, clearTimeout, Event
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    var verifyClicks = 0;
    var field = {value:'123456', maxLength:6, minLength:0, checkValidity:()=>true};
    var step = {kind:'otp',el:field,root:{},tries:0};
    var session = {attempted:new Set(),submitted:false,manualPageInput:false};
    otpSession = session;
    first = () => null;
    validOTP = () => true;
    enabled = () => true;
    busy = () => false;
    captchaPending = () => false;
    updateStage = () => {};
    automationSettings.autoSubmitOtp = false;
    submitOTPOnce(step, {click(){verifyClicks++;}});
  `, context);
  assert.equal(vm.runInContext('verifyClicks', context), 0);
  assert.equal(vm.runInContext('otpSession.attempted.size', context), 0);
});

test('configured scan gap is used for the normal workflow wait', () => {
  const context = vm.createContext({
    window: { location: { href: 'https://test.invalid/', hostname: 'test.invalid', pathname: '/' } },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, body: {} },
    chrome: { storage: { local: { set() {} } } },
    console, Event,
    setTimeout: (callback, delay) => { context.lastDelay = delay; return 1; },
    clearTimeout() {}
  });
  vm.runInContext(source, context);
  vm.runInContext('isRunning=true; automationSettings.scanGapMs=1700; scheduleWorkflow();', context);
  assert.equal(context.lastDelay, 1700);
});

test('trusted manual page actions resume a detected navigation step', () => {
  const context = vm.createContext({
    window: { location: { href: 'https://test.invalid/', hostname: 'test.invalid', pathname: '/' } },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, body: {} },
    chrome: { storage: { local: { set() {} } } },
    console, setTimeout, clearTimeout, Event
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    var pageButton = {
      textContent:'Take Your Appointment',
      getAttribute:()=>null,
      closest:selector=>selector==='#visa-automator-floating-panel' ? null : pageButton
    };
    var pageRoot = {contains:element=>element===pageButton};
    activeStep = {kind:'appointment',root:pageRoot,submitted:false};
    scheduleWorkflow = () => {};
    logMessage = () => {};
    observeManualWorkflowAction({isTrusted:true,target:pageButton,type:'click'});
  `, context);
  assert.equal(vm.runInContext('activeStep.submitted', context), true);
  assert.equal(vm.runInContext('activeStep.manualSubmitted', context), true);
});
