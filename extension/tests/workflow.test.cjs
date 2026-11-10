const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function engine() {
  let now = 100000;
  const context = vm.createContext({
    window: { location: { href: 'https://test.invalid/' } },
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      querySelector: () => null,
      body: {}
    },
    chrome: { storage: { local: { set() {} } } },
    console, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return now; } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8'), context);
  vm.runInContext(`
    var originalUploadSucceeded = uploadSucceeded;
    var originalPopupCleanup = executePopupCleanup;
    var originalPerformUploads = performUploads;
    var originalCaptchaPending = captchaPending;
    var originalUpdateStepTrackerUI = updateStepTrackerUI;
    var observed = [];
    var pageCandidates = [];
    var pageBlocked = false;
    var pageBusy = false;
    var popupClosed = false;
    var clicks = [];
    var captchaBlocked = false;
    logMessage = message => observed.push(message);
    updateStage = () => {};
    updateStepTrackerUI = () => {};
    executePopupCleanup = () => popupClosed;
    detectSteps = () => pageCandidates;
    busy = () => pageBusy;
    captchaPending = () => captchaBlocked;
    all = () => pageBlocked ? [{}] : [];
    first = () => null;
    performStep = step => clicks.push(step.kind);
    var sample = kind => ({ kind, el: { id: kind }, root: {} });
  `, context);
  return {
    run: code => vm.runInContext(code, context),
    advance: ms => { now += ms; }
  };
}

test('starts at uploads without fabricating earlier completion', () => {
  const e = engine();
  e.run(`pageCandidates = [sample('upload')]; executeWorkflowSteps();`);
  assert.equal(e.run('activeStep.kind'), 'upload');
  assert.equal(e.run('stepStatus.signIn'), false);
  assert.equal(e.run('stepStatus.otpVerified'), false);
});

test('pending OTP cannot advance just because upload is also visible', () => {
  const e = engine();
  e.run(`pageCandidates = [sample('otp'), sample('upload')]; executeWorkflowSteps(); executeWorkflowSteps();`);
  assert.equal(e.run('activeStep.kind'), 'otp');
  assert.equal(e.run('clicks.join(",")'), 'otp,otp');
});

test('a transiently missing step is not success', () => {
  const e = engine();
  e.run(`pageCandidates = [sample('otp')]; executeWorkflowSteps(); activeStep.submitted = true; pageCandidates = []; executeWorkflowSteps();`);
  e.advance(5000);
  e.run('executeWorkflowSteps();');
  assert.equal(e.run('activeStep.kind'), 'otp');
  assert.equal(e.run('stepStatus.otpVerified'), false);
});

test('requires stable recognized transition before marking completion', () => {
  const e = engine();
  e.run(`pageCandidates = [sample('otp')]; executeWorkflowSteps(); activeStep.submitted = true; pageCandidates = [sample('upload')]; executeWorkflowSteps();`);
  assert.equal(e.run('stepStatus.otpVerified'), false);
  e.advance(1300);
  e.run('executeWorkflowSteps();');
  assert.equal(e.run('stepStatus.otpVerified'), true);
  assert.equal(e.run('activeStep.kind'), 'upload');
});

test('without a submission, a missing step does not unlock another action', () => {
  const e = engine();
  e.run(`pageCandidates = [sample('otp')]; executeWorkflowSteps(); pageCandidates = [sample('upload')]; executeWorkflowSteps();`);
  e.advance(5000);
  e.run('executeWorkflowSteps();');
  assert.equal(e.run('activeStep.kind'), 'otp');
});

test('cleanup takes priority and retains the current pending step', () => {
  const e = engine();
  e.run(`pageCandidates = [sample('upload')]; executeWorkflowSteps(); popupClosed = true; executeWorkflowSteps();`);
  assert.equal(e.run('activeStep.kind'), 'upload');
  assert.equal(e.run('clicks.length'), 1);
});

test('informational Next popup can interrupt and resume a pending step', () => {
  const e = engine();
  e.run(`pageCandidates = [sample('upload')]; executeWorkflowSteps(); pageCandidates = [sample('next')]; executeWorkflowSteps();`);
  assert.equal(e.run('clicks.join(",")'), 'upload,next');
  assert.equal(e.run('activeStep.kind'), 'upload');
  assert.equal(e.run('stepStatus.filesUploaded'), false);
});

test('CAPTCHA and loading block workflow actions', () => {
  for (const block of ['captchaBlocked', 'pageBusy']) {
    const e = engine();
    e.run(`pageCandidates = [sample('signIn')]; ${block} = true; executeWorkflowSteps();`);
    assert.equal(e.run('clicks.length'), 0);
    assert.equal(e.run('stepStatus.signIn'), false);
  }
});

test('manual push cannot skip an unfinished action', () => {
  const e = engine();
  e.run(`pageCandidates = [sample('otp')]; executeWorkflowSteps(); runManualStep('upload');`);
  assert.equal(e.run('activeStep.kind'), 'otp');
  assert.equal(e.run('clicks.join(",")'), 'otp');
});

test('leaving calendar never fabricates a booked appointment', () => {
  const e = engine();
  e.run(`pageCandidates = [sample('booking')]; executeWorkflowSteps(); activeStep.submitted = true; pageCandidates = [sample('appointment')]; executeWorkflowSteps();`);
  e.advance(1300);
  e.run('executeWorkflowSteps();');
  assert.equal(e.run('stepStatus.slotBooked'), false);
});

test('submission retries respect increasing cooldowns and loaders', () => {
  const e = engine();
  e.run(`click = el => { clicks.push('click'); return true; }; var s = newStep(sample('otp')); submitStep(s, {}); submitStep(s, {});`);
  assert.equal(e.run('clicks.length'), 1);
  e.advance(3000);
  e.run('submitStep(s, {});');
  assert.equal(e.run('clicks.length'), 2);
  e.advance(3000);
  e.run('submitStep(s, {});');
  assert.equal(e.run('clicks.length'), 2);
  e.advance(3000);
  e.run('pageBusy = true; submitStep(s, {});');
  assert.equal(e.run('clicks.length'), 2);
});

test('stop clears scheduled work and disconnects observation', () => {
  const e = engine();
  e.run(`var disconnected = false; isRunning = true; workflowObserver = {disconnect() { disconnected = true; }}; stopAutomation();`);
  assert.equal(e.run('isRunning'), false);
  assert.equal(e.run('workflowObserver'), null);
  assert.equal(e.run('automatorInterval'), null);
  assert.equal(e.run('disconnected'), true);
});

test('a selected local file alone is not upload success', () => {
  const e = engine();
  e.run(`var localRoot = {querySelectorAll: () => [{}]}; var input = {dataset: {}, files: [{}], closest: () => localRoot};`);
  assert.equal(e.run('originalUploadSucceeded(input)'), false);
});

test('another upload tick in a shared container is not success', () => {
  const e = engine();
  e.run(`
    var shared = {querySelectorAll: () => [{}, {}]};
    var input = {dataset: {}, closest: () => shared};
    first = () => ({});
  `);
  assert.equal(e.run('originalUploadSucceeded(input)'), false);
  e.run(`input.dataset.uploadStatus = 'success';`);
  assert.equal(e.run('originalUploadSucceeded(input)'), true);
});

test('a scoped upload-success signal is accepted', () => {
  const e = engine();
  e.run(`
    var localRoot = {querySelectorAll: () => [{}]};
    var input = {dataset: {}, closest: () => localRoot};
    first = selector => selector === PAGE.uploadOK ? {} : null;
  `);
  assert.equal(e.run('originalUploadSucceeded(input)'), true);
});

test('upload confirmation waits for server acknowledgment of every file', () => {
  const e = engine();
  e.run(`
    var localRoot = {querySelectorAll: () => [{}]};
    var input = {dataset: {}, files: [{}], closest: () => localRoot};
    fileInputs = () => [input];
    uploadSucceeded = originalUploadSucceeded;
    button = pattern => pattern.test('Confirm all information is correct') ? {} : null;
    click = () => { clicks.push('confirm'); return true; };
    var uploadStep = newStep(sample('upload'));
    originalPerformUploads(uploadStep);
  `);
  assert.equal(e.run('clicks.length'), 0);
  e.run(`input.dataset.uploadStatus = 'success'; originalPerformUploads(uploadStep);`);
  assert.equal(e.run('clicks.join(",")'), 'confirm');
  assert.equal(e.run('stepStatus.filesUploaded'), false);
});

test('cleaner never clicks workflow dialog controls', () => {
  const e = engine();
  e.run(`
    var dialog = {};
    all = selector => selector === PAGE.dialogs ? [dialog] : [];
    hasWorkflowControls = () => true;
    click = () => { clicks.push('close'); return true; };
    originalPopupCleanup();
  `);
  assert.equal(e.run('clicks.length'), 0);
});

test('cleaner selects explicit Cancel rather than arbitrary Confirm', () => {
  const e = engine();
  e.run(`
    var dialog = {};
    var confirmButton = {getAttribute: () => null, textContent: 'Confirm', matches: () => false};
    var cancelButton = {getAttribute: () => null, textContent: 'Cancel', matches: () => false};
    all = (selector, root) => selector === PAGE.dialogs ? [dialog] : root === dialog ? [confirmButton, cancelButton] : [];
    hasWorkflowControls = () => false;
    click = el => { clicks.push(label(el)); return true; };
    originalPopupCleanup();
  `);
  assert.equal(e.run('clicks.join(",")'), 'Cancel');
});

test('CAPTCHA waits for provider response instead of trying to click frame', () => {
  const e = engine();
  e.run(`
    var response = {value: '', closest: () => null};
    var captchaRoot = {querySelectorAll: () => [response]};
    all = () => [{}];
  `);
  assert.equal(e.run('originalCaptchaPending(captchaRoot)'), true);
  e.run(`response.value = 'provider-verified-test-response';`);
  assert.equal(e.run('originalCaptchaPending(captchaRoot)'), false);
});

function trackerEngine() {
  const e = engine();
  e.run(`
    var nodes = {};
    document.createElement = tag => ({
      tagName: tag, style: {}, className: '', textContent: '',
      appendChild(child) { this.child = child; }
    });
    for (const item of TRACKER_STEPS) {
      var stateLabel = {textContent: ''};
      var push = {setAttribute() {}};
      var row = {
        dataset: {}, style: {}, stateLabel, push,
        setAttribute(key, value) { this[key] = value; },
        querySelector(selector) { return selector === 'button' ? this.push : this.stateLabel; }
      };
      var label = {firstChild: {textContent: ''}, parentElement: row};
      nodes[item.id] = {parentElement: label, style: {}, setAttribute() {}};
    }
    nodes['visa-step-list'] = {};
    nodes['visa-step-empty'] = {};
    document.getElementById = id => nodes[id] || null;
    updateStepTrackerUI = originalUpdateStepTrackerUI;
  `);
  return e;
}

test('tracker hides all future steps before the first detected screen', () => {
  const e = trackerEngine();
  e.run('updateStepTrackerUI();');
  assert.equal(e.run(`Object.values(nodes).filter(n => n.parentElement?.parentElement?.dataset.state).length`), 0);
  assert.equal(e.run(`nodes['visa-step-empty'].hidden`), false);
});

test('tracker reveals uploads directly with a spinner, not skipped login steps', () => {
  const e = trackerEngine();
  e.run(`isRunning = true; activeStep = newStep(sample('upload')); updateStepTrackerUI();`);
  assert.equal(e.run(`nodes['step-upload'].parentElement.parentElement.dataset.state`), 'active');
  assert.equal(e.run(`nodes['step-upload'].className`), 'va-step-spinner');
  assert.equal(e.run(`nodes['step-sign-in'].parentElement.parentElement.dataset.state`), undefined);
});

test('completed step keeps its checkmark while the next detected step is revealed', () => {
  const e = trackerEngine();
  e.run(`isRunning = true; activeStep = newStep(sample('signIn')); status('signIn', true); activeStep = newStep(sample('otp')); updateStepTrackerUI();`);
  assert.equal(e.run(`nodes['step-sign-in'].textContent`), '✓');
  assert.equal(e.run(`nodes['step-sign-in'].parentElement.parentElement.dataset.state`), 'complete');
  assert.equal(e.run(`nodes['step-otp'].className`), 'va-step-spinner');
  assert.equal(e.run(`nodes['step-upload'].parentElement.parentElement.dataset.state`), undefined);
});

test('stopping removes the working spinner without losing completed progress', () => {
  const e = trackerEngine();
  e.run(`isRunning = true; activeStep = newStep(sample('upload')); updateStepTrackerUI(); stopAutomation();`);
  assert.equal(e.run(`nodes['step-upload'].className`), '');
  assert.equal(e.run(`nodes['step-upload'].parentElement.parentElement.stateLabel.textContent`), 'Stopped');
});

test('reached steps are ordered by actual execution, not fixed step numbers', () => {
  const e = trackerEngine();
  e.run(`isRunning = true; activeStep = newStep(sample('upload')); status('upload', true); activeStep = newStep(sample('mission')); updateStepTrackerUI();`);
  assert.equal(e.run(`nodes['step-upload'].parentElement.parentElement.style.order`), 0);
  assert.equal(e.run(`nodes['step-mission'].parentElement.parentElement.style.order`), 1);
  assert.equal(e.run(`nodes['step-popups'].parentElement.parentElement.dataset.state`), undefined);
});
