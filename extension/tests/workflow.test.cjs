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
    var originalPerformStep = performStep;
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
  e.run(`click = el => { clicks.push('click'); return true; }; var s = newStep(sample('signIn')); submitStep(s, {}); submitStep(s, {});`);
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
    for (const id of ['workflow-status', 'workflow-title', 'workflow-detail', 'workflow-indicator', 'workflow-retry']) {
      nodes[id] = {textContent: '', className: '', setAttribute(key, value) { this[key] = value; }};
    }
    document.getElementById = id => nodes[id] || null;
    updateStepTrackerUI = originalUpdateStepTrackerUI;
  `);
  return e;
}

test('single status starts ready with no future or completed step list', () => {
  const e = trackerEngine();
  e.run('updateStepTrackerUI();');
  assert.equal(e.run(`nodes['workflow-title'].textContent`), 'Ready');
  assert.equal(e.run(`nodes['workflow-indicator'].className`), '');
  assert.equal(e.run(`document.getElementById('visa-step-list')`), null);
});

test('single status displays detected uploads with a spinner', () => {
  const e = trackerEngine();
  e.run(`isRunning = true; activeStep = newStep(sample('upload')); updateStepTrackerUI();`);
  assert.equal(e.run(`nodes['workflow-title'].textContent`), 'Upload documents');
  assert.equal(e.run(`nodes['workflow-indicator'].className`), 'va-working');
  assert.equal(e.run(`nodes['workflow-status']['aria-busy']`), 'true');
});

test('next detected step replaces completed progress rather than adding rows', () => {
  const e = trackerEngine();
  e.run(`isRunning = true; activeStep = newStep(sample('signIn')); status('signIn', true); activeStep = newStep(sample('otp')); updateStepTrackerUI();`);
  assert.equal(e.run(`nodes['workflow-title'].textContent`), 'Verify OTP');
  assert.equal(e.run('Object.keys(nodes).length'), 5);
  assert.equal(e.run('stepStatus.signIn'), true);
});

test('stopping removes the status spinner and shows stopped text', () => {
  const e = trackerEngine();
  e.run(`isRunning = true; activeStep = newStep(sample('upload')); updateStepTrackerUI(); stopAutomation();`);
  assert.equal(e.run(`nodes['workflow-indicator'].className`), '');
  assert.match(e.run(`nodes['workflow-detail'].textContent`), /Stopped/);
});

test('status scans dynamically when no current element is available', () => {
  const e = trackerEngine();
  e.run(`isRunning = true; updateStepTrackerUI();`);
  assert.equal(e.run(`nodes['workflow-title'].textContent`), 'Detecting current step');
  assert.equal(e.run(`nodes['workflow-indicator'].className`), 'va-working');
});

test('reset clears in-memory workflow data and does not write defaults to storage', () => {
  const e = trackerEngine();
  e.run(`
    var writes = 0;
    chrome.storage.local.set = () => writes++;
    isRunning = true;
    uploadedFilesMap[1] = {name: 'test.pdf'};
    primarySlotKey = 2;
    activeStep = newStep(sample('upload'));
    trackerNextComplete = true;
    stepStatus.signIn = true;
    var originalGeneration = storageGeneration;
    resetPanelState();
  `);
  assert.equal(e.run('writes'), 0);
  assert.equal(e.run('isRunning'), false);
  assert.equal(e.run('primarySlotKey'), null);
  assert.equal(e.run('activeStep'), null);
  assert.equal(e.run('trackerHistory.length'), 0);
  assert.equal(e.run('Object.values(uploadedFilesMap).every(v => v === null)'), true);
  assert.equal(e.run('Object.values(stepStatus).every(v => v === false)'), true);
  assert.equal(e.run('storageGeneration > originalGeneration'), true);
});

function backgroundEngine() {
  let listener;
  const store = { savedPhone: 'test-phone', savedPass: 'test-password', savedFilesMap: { 1: {} }, primarySlot: 2 };
  const events = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), {
    chrome: {
      action: { onClicked: { addListener() {} } },
      runtime: { onMessage: { addListener(fn) { listener = fn; } } },
      tabs: {
        async query() { return [{ id: 1 }, { id: 2 }]; },
        async sendMessage(id, message) { events.push(`${id}:${message.type}`); }
      },
      storage: { local: { async clear() {
        events.push('clear');
        for (const key of Object.keys(store)) delete store[key];
      } } }
    },
    console, URL, AbortController, setTimeout, clearTimeout
  });
  return { store, events, listener };
}

test('RESET broadcasts before clearing storage and leaves no saved keys', async () => {
  const b = backgroundEngine();
  const result = await new Promise(resolve => b.listener(
    { type: 'RESET_AUTOMATOR' }, { tab: { url: 'https://appointment.ivacbd.com/' } }, resolve
  ));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(b.store), []);
  assert.deepEqual(b.events, ['1:RESET_AUTOMATOR_STATE', '2:RESET_AUTOMATOR_STATE', 'clear']);
});

test('untrusted pages cannot request an extension storage reset', async () => {
  const b = backgroundEngine();
  const result = await new Promise(resolve => b.listener(
    { type: 'RESET_AUTOMATOR' }, { tab: { url: 'https://other.invalid/' } }, resolve
  ));
  assert.equal(result.ok, false);
  assert.equal(Object.keys(b.store).length, 4);
  assert.deepEqual(b.events, []);
});

function otpEngine() {
  const e = engine();
  e.run(`
    var otpPanel = {value: ''};
    var hasOTPError = false;
    var hasOTPSuccess = false;
    var messages = [];
    var otpRoot = {contains: () => true};
    var otpField = {
      value: '', maxLength: 6, minLength: 0,
      checkValidity: () => true, matches: () => true,
      closest: selector => selector === '#visa-automator-floating-panel' ? null : otpRoot
    };
    var verifyButton = {
      textContent: 'Verify', getAttribute: () => null,
      closest: selector => selector === '#visa-automator-floating-panel' ? null : verifyButton,
      click() { clicks.push('verify'); }
    };
    document.getElementById = id => id === 'otp-input-field' ? otpPanel : null;
    first = selector => selector === PAGE.otp ? otpField :
      selector === PAGE.otpError ? (hasOTPError ? {} : null) :
      selector === PAGE.otpOK ? (hasOTPSuccess ? {} : null) : null;
    visible = () => true;
    enabled = el => !!el && !el.disabled;
    button = () => verifyButton;
    setValue = (el, value) => { el.value = value; };
    scheduleWorkflow = () => {};
    chrome.runtime = {id: 'test', sendMessage(message, callback) { messages.push({message, callback}); }};
    var candidate = {kind: 'otp', el: otpField, root: otpRoot};
    activeStep = newStep(candidate);
    pageCandidates = [candidate];
    performStep = originalPerformStep;
  `);
  return e;
}

test('OTP fills and submits once even after repeated checks and long waits', () => {
  const e = otpEngine();
  e.run(`otpPanel.value = '123456'; performOTP(activeStep); performOTP(activeStep);`);
  e.advance(60000);
  e.run('performOTP(activeStep);');
  assert.equal(e.run('otpField.value'), '123456');
  assert.equal(e.run(`clicks.join(',')`), 'verify');
  assert.equal(e.run('stepStatus.otpVerified'), false);
});

test('OTP waits for an enabled verification button without consuming its attempt', () => {
  const e = otpEngine();
  e.run(`otpPanel.value = '123456'; verifyButton.disabled = true; performOTP(activeStep);`);
  assert.equal(e.run('getOTPSession().attempted.size'), 0);
  e.run(`verifyButton.disabled = false; performOTP(activeStep); performOTP(activeStep);`);
  assert.equal(e.run('clicks.length'), 1);
});

test('automatic Termux fetching fills and verifies only once through background messaging', () => {
  const e = otpEngine();
  e.run(`isRunning = true; performOTP(activeStep); performOTP(activeStep);`);
  assert.equal(e.run('messages.length'), 1);
  e.run(`messages[0].callback({ok:true,data:{success:true,otp:'123456'}}); performOTP(activeStep);`);
  assert.equal(e.run('otpField.value'), '123456');
  assert.equal(e.run('clicks.length'), 1);
  assert.equal(e.run('messages.length'), 1);
  assert.equal(e.run('isRunning'), true);
});

test('waiting for SMS uses paced polling with no overlapping fetch requests', () => {
  const e = otpEngine();
  e.run(`isRunning = true; performOTP(activeStep); performOTP(activeStep);`);
  assert.equal(e.run('messages.length'), 1);
  e.run(`messages[0].callback({ok:true,data:{success:false}}); performOTP(activeStep);`);
  assert.equal(e.run('messages.length'), 1);
  e.advance(5000);
  e.run('performOTP(activeStep);');
  assert.equal(e.run('messages.length'), 2);
  assert.equal(e.run('isRunning'), true);
  assert.equal(e.run('clicks.length'), 0);
});

test('a late fetched OTP cannot overwrite a user typing on the website', () => {
  const e = otpEngine();
  e.run(`
    isRunning = true; performOTP(activeStep);
    otpField.value = '654321';
    observeManualOTP({type:'input', isTrusted:true, target:otpField});
    messages[0].callback({ok:true,data:{success:true,otp:'123456'}});
    performOTP(activeStep);
  `);
  assert.equal(e.run('otpField.value'), '654321');
  assert.equal(e.run('otpPanel.value'), '');
  assert.equal(e.run('clicks.length'), 0);
});

test('manual website Verify is observed and automation resumes after the stable next screen', () => {
  const e = otpEngine();
  e.run(`
    otpField.value = '654321';
    observeManualOTP({type:'input',isTrusted:true,target:otpField});
    observeManualOTP({type:'click',isTrusted:true,target:verifyButton});
    performStep = step => clicks.push(step.kind);
    pageCandidates = [sample('upload')];
    executeWorkflowSteps();
  `);
  assert.equal(e.run('stepStatus.otpVerified'), false);
  e.advance(1300);
  e.run('executeWorkflowSteps();');
  assert.equal(e.run('stepStatus.otpVerified'), true);
  assert.equal(e.run('activeStep.kind'), 'upload');
  assert.equal(e.run('otpPanel.value'), '');
});

test('manual form submission without an input event still unlocks a verified transition', () => {
  const e = otpEngine();
  e.run(`
    otpField.value = '654321';
    observeManualOTP({type:'submit',isTrusted:true,target:otpRoot});
  `);
  assert.equal(e.run('activeStep.submitted'), true);
  assert.equal(e.run('getOTPSession().attempted.has("654321")'), true);
});

test('rejected OTP is not retried; a new distinct code may be submitted once', () => {
  const e = otpEngine();
  e.run(`otpPanel.value = '123456'; performOTP(activeStep); hasOTPError = true; performOTP(activeStep);`);
  assert.equal(e.run('clicks.length'), 1);
  e.run(`otpPanel.value = '654321'; performOTP(activeStep); performOTP(activeStep);`);
  assert.equal(e.run('clicks.length'), 2);
});

test('stop and resume preserve the once-per-code submission guard', () => {
  const e = otpEngine();
  e.run(`otpPanel.value = '123456'; performOTP(activeStep); stopAutomation(); isRunning = true; performOTP(activeStep);`);
  assert.equal(e.run('clicks.length'), 1);
});

test('reset invalidates pending fetched OTP responses', () => {
  const e = otpEngine();
  e.run(`isRunning = true; performOTP(activeStep); resetPanelState(); messages[0].callback({ok:true,data:{success:true,otp:'123456'}});`);
  assert.equal(e.run('otpPanel.value'), '');
  assert.equal(e.run('clicks.length'), 0);
  assert.equal(e.run('otpSession'), null);
});

test('returning to sign-in cannot be mistaken for successful OTP verification', () => {
  const e = otpEngine();
  e.run(`otpPanel.value = '123456'; performOTP(activeStep); pageCandidates = [sample('signIn')]; executeWorkflowSteps();`);
  e.advance(5000);
  e.run('executeWorkflowSteps();');
  assert.equal(e.run('stepStatus.otpVerified'), false);
  assert.equal(e.run('activeStep.kind'), 'otp');
});

test('browser-generated form submit during the automatic click is not a manual override', () => {
  const e = otpEngine();
  e.run(`
    verifyButton.click = () => {
      clicks.push('verify');
      observeManualOTP({type:'submit',isTrusted:true,target:otpRoot});
    };
    otpPanel.value = '123456';
    performOTP(activeStep);
    performOTP(activeStep);
  `);
  assert.equal(e.run('clicks.length'), 1);
  assert.equal(e.run('getOTPSession().manualPageInput'), false);
  assert.equal(e.run('getOTPSession().submitted'), true);
});
