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
    console, setTimeout, clearTimeout, Event,
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
    var originalDetectSteps = detectSteps;
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
  e.run(`pageCandidates = [sample('upload')]; executeWorkflowSteps(); pageCandidates = [{...sample('next'), interruption:true}]; executeWorkflowSteps();`);
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
    var file = {name:'test.pdf',size:1};
    uploadedFilesMap[1] = file;
    var input = {dataset: {}, files: [file], closest: () => localRoot};
    fileInputs = () => [input];
    uploadSucceeded = originalUploadSucceeded;
    var confirmButton = {textContent:'Confirm all information is correct',getAttribute:()=>null};
    all = selector => selector.startsWith('button') ? [confirmButton] : [];
    enabled = el => !!el;
    click = () => { clicks.push('confirm'); return true; };
    var uploadStep = newStep(sample('upload'));
    uploadStep.uploadRecords = [{file,attached:true,done:false,sawPending:true}];
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

test('cleaner does not treat a generic OK action as cancellation', () => {
  const e = engine();
  e.run(`
    var dialog = {};
    var okButton = {getAttribute: () => null, textContent: 'OK', matches: () => false};
    all = (selector, root) => selector === PAGE.dialogs ? [dialog] : root === dialog ? [okButton] : [];
    hasWorkflowControls = () => false;
    click = el => { clicks.push(label(el)); return true; };
    originalPopupCleanup();
  `);
  assert.equal(e.run('clicks.length'), 0);
});

test('Important Notice and ADVISORY headings are recognized as required notices', () => {
  for (const text of [
    'Important Notice: booking hours and file requirements',
    'ADVISORY – Mandatory Submission of Visa Undertaking Form'
  ]) {
    const e = engine();
    e.run(`
      var notice = {innerText: ${JSON.stringify(text)}, textContent: ${JSON.stringify(text)}};
      var recognized = isRequiredNoticeDialog(notice);
    `);
    assert.equal(e.run('recognized'), true);
  }
});

test('required notice is preserved and blocks automation until manually closed', () => {
  const e = engine();
  e.run(`
    var noticePresent = true;
    var notice = {
      innerText: 'Important Notice: review appointment hours',
      textContent: 'Important Notice: review appointment hours',
      getAttribute: () => null,
      querySelectorAll: () => []
    };
    var closeButton = {
      textContent: '×',
      getAttribute: () => null,
      matches: () => false,
      closest: () => notice
    };
    var visibleStage = '';
    all = (selector, root) => {
      if (selector === PAGE.dialogs) return noticePresent ? [notice] : [];
      if (selector === '.modal-close, button[aria-label="Close"], button[aria-label="Dismiss"], [data-bs-dismiss="modal"], [data-dismiss="modal"]') return noticePresent ? [closeButton] : [];
      return root === notice ? [closeButton] : [];
    };
    click = () => { clicks.push('close'); return true; };
    executePopupCleanup = originalPopupCleanup;
    updateStage = stage => { visibleStage = stage; };
    pageCandidates = [sample('upload')];
    executeWorkflowSteps();
  `);
  assert.equal(e.run('clicks.length'), 0);
  assert.equal(e.run('activeStep'), null);
  assert.equal(e.run('visibleStage'), 'Review IVAC notice');
  e.run(`noticePresent = false; executeWorkflowSteps();`);
  assert.equal(e.run('clicks.join(",")'), 'upload');
  assert.equal(e.run('activeStep.kind'), 'upload');
});

test('new DOM dialogs are identified immediately by the popup observer helper', () => {
  const e = engine();
  e.run(`
    var dialogNode = {
      nodeType: 1,
      matches: selector => selector === PAGE.dialogs,
      querySelector: () => null
    };
    var popupMutationDetected = mutationAddsDialog([{addedNodes: [dialogNode]}]);
  `);
  assert.equal(e.run('popupMutationDetected'), true);
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
    importScripts() {},
    PhoneRelay: { serial: work => work(), reset: async () => {} },
    chrome: {
      action: { onClicked: { addListener() {} } },
      runtime: { getURL: file => `chrome-extension://test/${file}`, onMessage: { addListener(fn) { listener = fn; } } },
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

test('automatic paired-phone fetching fills and verifies only once through background messaging', () => {
  const e = otpEngine();
  e.run(`isRunning = true; performOTP(activeStep); performOTP(activeStep);`);
  assert.equal(e.run('messages.length'), 1);
  e.run(`messages[0].callback({ok:true,data:{success:true,otp:'123456'}}); performOTP(activeStep);`);
  assert.equal(e.run('otpField.value'), '123456');
  assert.equal(e.run('clicks.length'), 1);
  assert.equal(e.run('messages.length'), 1);
  assert.equal(e.run('isRunning'), true);
});

test('manual Fill OTP interrupts a pending wait and fills without submitting', () => {
  const e = otpEngine();
  e.run(`isRunning = true; performOTP(activeStep); pollOTPFromBackground(false,{force:true,fillOnly:true});`);
  assert.equal(e.run('messages.length'), 2);
  assert.equal(e.run('messages[0].message.type'), 'WAIT_OTP');
  assert.equal(e.run('messages[1].message.type'), 'FETCH_OTP');
  e.run(`messages[0].callback({ok:true,data:{success:true,otp:'111111'}});`);
  assert.equal(e.run('otpField.value'), '');
  e.run(`messages[1].callback({ok:true,data:{success:true,otp:'027922',messageId:'relay-message'}}); performOTP(activeStep);`);
  assert.equal(e.run('otpField.value'), '027922');
  assert.equal(e.run('otpPanel.value'), '027922');
  assert.equal(e.run('clicks.length'), 0);
  assert.equal(e.run('getOTPSession().manualFillPending'), true);
  assert.equal(e.run('getOTPSession().relayMessageId'), 'relay-message');
});

test('manual Fill OTP does not overwrite an OTP already typed on the official page', () => {
  const e = otpEngine();
  e.run(`otpField.value='654321'; getOTPSession().manualPageInput=true; pollOTPFromBackground(false,{force:true,fillOnly:true});`);
  assert.equal(e.run('messages.length'), 0);
  assert.equal(e.run('otpField.value'), '654321');
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

test('phone polling checks again after 500ms and keeps leading-zero OTP submission single-attempt', () => {
  const e = otpEngine();
  e.run(`isRunning=true; performOTP(activeStep); messages[0].callback({ok:true,data:{success:false}});`);
  e.advance(499);
  e.run('performOTP(activeStep);');
  assert.equal(e.run('messages.length'), 1);
  e.advance(1);
  e.run(`performOTP(activeStep); messages[1].callback({ok:true,data:{success:true,otp:'027922'}}); performOTP(activeStep);`);
  assert.equal(e.run('otpField.value'), '027922');
  assert.equal(e.run('clicks.length'), 1);
  e.advance(2000);
  e.run('performOTP(activeStep);');
  assert.equal(e.run('clicks.length'), 1);
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

test('landing page Sign In is detected when no form is visible', () => {
  const e = engine();
  e.run(`
    var landingButton = {textContent:'Sign In',getAttribute:()=>null,closest:()=>null};
    all = selector => selector.startsWith('button') ? [landingButton] : [];
    fileInputs = () => [];
    var detected = originalDetectSteps();
  `);
  assert.equal(e.run('detected[0].kind'), 'login');
});

test('plain Next is a real page step, not a popup interruption', () => {
  const e = engine();
  e.run(`
    var nextButton = {textContent:'Next',getAttribute:()=>null,closest:()=>null};
    all = selector => selector.startsWith('button') ? [nextButton] : [];
    fileInputs = () => [];
    var detected = originalDetectSteps();
  `);
  assert.equal(e.run('detected[0].kind'), 'next');
  assert.equal(e.run('!!detected[0].interruption'), false);
});

test('Next Step intro and Save & Continue details are detected by their exact live labels', () => {
  for (const [text, kind] of [['Next Step','next'], ['Save & Continue','details']]) {
    const e = engine();
    e.run(`
      fileInputs=()=>[]; first=()=>null;
      var action={textContent:${JSON.stringify(text)},getAttribute:()=>null,closest:()=>null};
      all=selector=>selector.startsWith('button') ? [action] : [];
      var detected=originalDetectSteps();
    `);
    assert.equal(e.run('detected[0].kind'), kind);
  }
});

test('required details popup is preserved even when it has a close button', () => {
  const e = engine();
  e.run(`
    var detailsDialog={};
    var save={textContent:'Save & Continue',getAttribute:()=>null};
    var close={textContent:'Close',getAttribute:()=>null,closest:()=>detailsDialog};
    all=selector=>selector===PAGE.dialogs ? [detailsDialog] :
      selector==='button, a[href], input[type="submit"], input[type="button"], [role="button"]' ? [save] : [close];
    first=()=>null; fileInputs=()=>[];
    click=el=>{clicks.push(el);return true;};
    originalPopupCleanup();
  `);
  assert.equal(e.run('clicks.length'), 0);
});

test('confirmed upload advances into the required details modal rather than being blocked by it', () => {
  const e = engine();
  e.run(`
    pageCandidates=[sample('upload')]; executeWorkflowSteps();
    activeStep.submitted=true; activeStep.uploadContinueSent=true;
    activeStep.uploadRecords=[{done:true}];
    pageCandidates=[sample('details')];
    var detailsModal={contains:el=>el===pageCandidates[0].el};
    all=selector=>selector===PAGE.dialogs ? [detailsModal] : [];
    executeWorkflowSteps();
  `);
  e.advance(1300);
  e.run('executeWorkflowSteps();');
  assert.equal(e.run('activeStep.kind'), 'details');
  assert.equal(e.run('stepStatus.filesUploaded'), true);
});

function uploadFlowEngine() {
  const e = engine();
  e.run(`
    class MockTransfer {
      constructor() { this.files = []; this.items = {add:file=>this.files.push(file)}; }
    }
    DataTransfer = MockTransfer;
    var attached = [];
    var uploads = FILE_SLOTS.map((slot,index) => ({
      dataset:{}, files:[], ack:false, disabled:false, matches:()=>false,
      dispatchEvent(event) { if(event.type==='change') { this.ack=false; attached.push(this.files[0].name); } }
    }));
    FILE_SLOTS.forEach(slot => uploadedFilesMap[slot] = {name:'document-'+slot+'.pdf',size:1});
    primarySlotKey = 3;
    fileInputs = () => uploads;
    uploadScope = input => input;
    uploadSucceeded = input => input.ack;
    uploadReceipt = input => String(input.ack);
    var continueButton = {textContent:'Continue',getAttribute:()=>null};
    all = selector => selector.startsWith('button') ? [continueButton] : [];
    enabled = el => !!el && !el.disabled;
    click = () => {clicks.push('continue');return true;};
    var uploadStep = newStep(sample('upload'));
  `);
  return e;
}

test('four documents upload primary-first and never advance ahead of acknowledgment', () => {
  const e = uploadFlowEngine();
  e.run(`performUploads(uploadStep); performUploads(uploadStep);`);
  assert.equal(e.run('attached.join(",")'), 'document-3.pdf');
  assert.equal(e.run('clicks.length'), 0);
  for (let i = 0; i < 3; i++) {
    e.run(`uploads[${i}].ack = true; performUploads(uploadStep);`);
  }
  assert.equal(e.run('attached.join(",")'), 'document-3.pdf,document-1.pdf,document-2.pdf,document-4.pdf');
  assert.equal(e.run('clicks.length'), 0);
  e.advance(1000);
  e.run(`uploads[3].ack = true; performUploads(uploadStep);`);
  assert.equal(e.run('clicks.length'), 1);
  assert.equal(e.run('uploadStep.uploadContinueSent'), true);
  assert.equal(e.run('stepStatus.filesUploaded'), false);
});

test('upload loop discovers applicant fields added after the primary is acknowledged', () => {
  const e = uploadFlowEngine();
  e.run(`
    uploads = [uploads[0]];
    performUploads(uploadStep);
    uploads[0].ack = true;
    uploads.push({
      dataset:{}, files:[], ack:false, disabled:false, matches:()=>false,
      dispatchEvent(event) {
        if (event.type === 'change') {
          this.ack = false;
          attached.push(this.files[0].name);
        }
      }
    });
    performUploads(uploadStep);
  `);
  assert.equal(e.run('attached.join(",")'), 'document-3.pdf,document-1.pdf');
  assert.equal(e.run('uploadStep.uploadRecords[0].done'), true);
  assert.equal(e.run('uploadStep.uploadRecords[1].attached'), true);
  assert.equal(e.run('uploadStep.uploadRecords[1].input === uploads[1]'), true);
  assert.equal(e.run('clicks.length'), 0);
});

test('already confirmed primary file is skipped and the next slot is uploaded', () => {
  const e = uploadFlowEngine();
  e.run(`
    primarySlotKey = 1;
    var primaryRow = {
      textContent: 'document-1.pdf',
      getAttribute: name => name === 'data-upload-status' ? 'success' :
        name === 'data-file-name' ? 'document-1.pdf' : null,
      matches: () => false,
      querySelectorAll: () => []
    };
    all = selector => selector.startsWith('button') ? [continueButton] :
      selector.includes('[data-upload-item]') ? [primaryRow] : [];
    performUploads(uploadStep);
  `);
  assert.equal(e.run('uploadStep.uploadRecords[0].done'), true);
  assert.equal(e.run('uploadStep.uploadRecords[0].input === uploads[0]'), true);
  assert.equal(e.run('attached.join(",")'), 'document-2.pdf');
  assert.equal(e.run('uploadStep.uploadRecords[1].attached'), true);
  assert.equal(e.run('uploadStep.uploadRecords[1].input === uploads[1]'), true);
});

test('confirmed existing upload is recognized even after the page removes its input', () => {
  const e = uploadFlowEngine();
  e.run(`
    uploadedFilesMap = {1:uploadedFilesMap[1],2:null,3:null,4:null};
    primarySlotKey = 1;
    fileInputs = () => [];
    var primaryRow = {
      textContent: 'document-1.pdf',
      getAttribute: name => name === 'data-upload-status' ? 'success' :
        name === 'data-file-name' ? 'document-1.pdf' : null,
      matches: () => false,
      querySelectorAll: () => []
    };
    all = selector => selector.startsWith('button') ? [continueButton] :
      selector.includes('[data-upload-item]') ? [primaryRow] : [];
    performUploads(uploadStep);
  `);
  assert.equal(e.run('uploadStep.uploadRecords[0].done'), true);
  assert.equal(e.run('uploadStep.uploadContinueSent'), true);
  assert.equal(e.run('clicks.join(",")'), 'continue');
});

test('filename without an upload success signal is not treated as already uploaded', () => {
  const e = engine();
  e.run(`
    var filenameRow = {
      textContent: 'document-1.pdf',
      getAttribute: name => name === 'data-file-name' ? 'document-1.pdf' : null,
      matches: () => false,
      querySelectorAll: () => []
    };
    all = selector => selector.includes('[data-upload-item]') ? [filenameRow] : [];
    var alreadyUploaded = pageConfirmsFile({name:'document-1.pdf',size:1}, []);
  `);
  assert.equal(e.run('alreadyUploaded'), false);
});

test('disabled primary input blocks all secondary document attachments', () => {
  const e = uploadFlowEngine();
  e.run(`uploads[0].disabled = true; performUploads(uploadStep);`);
  assert.equal(e.run('attached.length'), 0);
  e.run(`uploads[0].disabled = false; performUploads(uploadStep);`);
  assert.equal(e.run('attached.join(",")'), 'document-3.pdf');
});

test('an empty selected primary slot cannot silently promote secondary files', () => {
  const e = uploadFlowEngine();
  e.run(`uploadedFilesMap[3] = null; performUploads(uploadStep);`);
  assert.equal(e.run('attached.length'), 0);
});

test('a reusable upload input needs a new acknowledgment for each file', () => {
  const e = uploadFlowEngine();
  e.run(`
    uploads = [uploads[0]];
    // This fixture deliberately leaves the previous success signal unchanged.
    uploads[0].dispatchEvent = function(event) {
      if(event.type==='change') attached.push(this.files[0].name);
    };
    performUploads(uploadStep);
    uploads[0].ack = true;
    performUploads(uploadStep);
    performUploads(uploadStep);
  `);
  assert.equal(e.run('attached.length'), 2);
  assert.equal(e.run('uploadStep.uploadRecords[1].done'), false);
  assert.equal(e.run('clicks.length'), 0);
  e.run(`uploads[0].ack = false; performUploads(uploadStep); uploads[0].ack = true; performUploads(uploadStep);`);
  assert.equal(e.run('attached.length'), 3);
});

test('empty optional website slots do not demand documents absent from the panel', () => {
  const e = uploadFlowEngine();
  e.run(`
    uploadedFilesMap = {1:uploadedFilesMap[1],2:null,3:null,4:null};
    primarySlotKey = 1;
    performUploads(uploadStep);
  `);
  e.advance(1000);
  e.run(`uploads[0].ack = true; performUploads(uploadStep);`);
  assert.equal(e.run('clicks.length'), 1);
});

test('required empty website slots block Continue after loaded files finish', () => {
  const e = uploadFlowEngine();
  e.run(`
    uploadedFilesMap = {1:uploadedFilesMap[1],2:null,3:null,4:null};
    primarySlotKey = 1;
    uploads[1].required = true;
    performUploads(uploadStep);
  `);
  e.advance(1000);
  e.run(`uploads[0].ack = true; performUploads(uploadStep);`);
  assert.equal(e.run('clicks.length'), 0);
});

test('mission remains unchanged while an enabled available IVAC center is selected', () => {
  const e = engine();
  e.run(`
    var placeholder = {value:'',textContent:'Select center',disabled:false};
    var disabled = {value:'closed',textContent:'Unavailable',disabled:true};
    var available = {value:'open',textContent:'Available IVAC',disabled:false};
    var mission = {value:'already-selected',selectedIndex:0,options:[{value:'already-selected',textContent:'Existing Mission'}]};
    var center = {value:'',selectedIndex:0,options:[placeholder,disabled,available]};
    first = selector => selector===PAGE.mission ? mission : selector===PAGE.center ? center : null;
    setValue = (el,value) => {el.value=value;return true;};
    var missionStep = newStep(sample('mission'));
    performMissionSelection(missionStep);
  `);
  assert.equal(e.run('mission.value'), 'already-selected');
  assert.equal(e.run('center.value'), 'open');
});

test('mission selection waits while the center dropdown has no available options', () => {
  const e = engine();
  e.run(`
    var center = {value:'',selectedIndex:0,options:[{value:'',textContent:'Select center'}]};
    first = selector => selector===PAGE.center ? center : null;
    setValue = () => clicks.push('selected');
    performMissionSelection(newStep(sample('mission')));
  `);
  assert.equal(e.run('clicks.length'), 0);
});

test('mission selection waits rather than submitting a different configured center', () => {
  const e = engine();
  e.run(`
    var mission={selectedIndex:0,options:[{value:'existing',textContent:'Existing mission'}]};
    var center={value:'',selectedIndex:0,options:[{value:'',textContent:'Select IVAC center'},
      {value:'other',textContent:'Other center'}]};
    first=selector=>selector===PAGE.mission ? mission : selector===PAGE.center ? center : null;
    document.getElementById=id=>id==='config-center' ? {value:'required-center'} : null;
    setValue=()=>{throw Error('Wrong center must not be selected');};
    submitStep=()=>{throw Error('Wrong center must not be confirmed');};
    performMissionSelection(newStep(sample('mission')));
  `);
  assert.equal(e.run('center.value'), '');
});

test('native mission selection recognizes the exact Confirm Mission & IVAC Center action', () => {
  const e = engine();
  e.run(`
    var center={value:'chosen',selectedIndex:0,options:[{value:'chosen',textContent:'Dhaka center'}]};
    var confirm={textContent:'Confirm Mission & IVAC Center',getAttribute:()=>null};
    first=selector=>selector===PAGE.center ? center : null;
    all=selector=>selector.startsWith('button') ? [confirm] : [];
    submitStep=(step,el)=>{if(el) clicks.push(el);};
    performMissionSelection(newStep(sample('mission')));
  `);
  assert.equal(e.run('clicks.length'), 1);
});

function calendarEngine() {
  const e = engine();
  e.run(`
    var dateNodes = [1,2,3,4,5].map(n => ({
      id:'date-'+n, textContent:String(n),
      getAttribute:name=>name==='data-date'?'2026-12-'+String(n).padStart(2,'0'):null,
      closest:()=>null
    }));
    var bookingButton = {id:'continue-booking',disabled:false};
    var calendarClicks = [];
    all = selector => selector===PAGE.dates ? dateNodes : [];
    enabled = el => !!el && !el.disabled;
    button = () => bookingButton;
    click = el => {calendarClicks.push({id:el.id,at:Date.now()});return true;};
    var bookingStep = newStep(sample('booking'));
  `);
  return e;
}

test('middle-first ordering covers every date before repeating', () => {
  const e = engine();
  assert.equal(e.run('JSON.stringify(middleOut([1,2,3,4,5]))'), '[3,4,2,5,1]');
  assert.equal(e.run('JSON.stringify(middleOut([1,2,3,4]))'), '[2,3,1,4]');
  assert.equal(e.run('JSON.stringify(middleOut([]))'), '[]');
});

test('calendar finds plain numeric buttons without requiring available CSS classes', () => {
  const e = engine();
  e.run(`
    var cells=[1,2,3,4,5].map(n=>({textContent:String(n),disabled:n===1,
      getAttribute:()=>null,closest:()=>null,matches:()=>false}));
    all=selector=>selector==='button, [role="button"]' ? cells : [];
    button=()=>({}); enabled=el=>!el.disabled;
    var available=availableCalendarDates({});
  `);
  assert.equal(e.run('available.map(label).join(",")'), '2,3,4,5');
});

test('calendar starts in the middle and clicks Continue only once per attempt', () => {
  const e = calendarEngine();
  e.run('performCalendarSearch(bookingStep);');
  assert.equal(e.run('calendarClicks[0].id'), 'date-3');
  e.advance(500);
  e.run('performCalendarSearch(bookingStep); performCalendarSearch(bookingStep);');
  assert.equal(e.run('calendarClicks.length'), 2);
  assert.equal(e.run('calendarClicks[1].id'), 'continue-booking');
});

test('failed attempt waits 20 seconds after Continue before selecting another date', () => {
  const e = calendarEngine();
  e.run('performCalendarSearch(bookingStep);');
  e.advance(500);
  e.run('performCalendarSearch(bookingStep);');
  e.advance(19999);
  e.run('performCalendarSearch(bookingStep);');
  assert.equal(e.run('calendarClicks.length'), 2);
  e.advance(1);
  e.run('performCalendarSearch(bookingStep);');
  assert.equal(e.run('calendarClicks[2].id'), 'date-4');
  assert.equal(e.run('calendarClicks[2].at-calendarClicks[1].at'), 20000);
});

test('calendar cycles through all middle-out dates and then repeats persistently', () => {
  const e = calendarEngine();
  for (let i = 0; i < 6; i++) {
    e.run('performCalendarSearch(bookingStep);');
    e.advance(500);
    e.run('performCalendarSearch(bookingStep);');
    e.advance(20000);
  }
  assert.equal(e.run(`calendarClicks.filter(c=>c.id!=='continue-booking').map(c=>c.id).join(',')`),
    'date-3,date-4,date-2,date-5,date-1,date-3');
  assert.equal(e.run('bookingStep.calendar.cycle'), 2);
});

test('reload recovery preserves retry pacing and moves to an untried date', () => {
  const e = calendarEngine();
  e.run('performCalendarSearch(bookingStep); bookingStep = newStep(sample("booking")); performCalendarSearch(bookingStep);');
  assert.equal(e.run('calendarClicks.length'), 1);
  e.advance(20000);
  e.run('performCalendarSearch(bookingStep);');
  assert.equal(e.run('calendarClicks[1].id'), 'date-4');
});

test('empty and disabled date lists do not fabricate a booking attempt', () => {
  const e = calendarEngine();
  e.run('dateNodes.forEach(el=>el.disabled=true); isRunning=true; performCalendarSearch(bookingStep);');
  assert.equal(e.run('calendarClicks.length'), 0);
  assert.equal(e.run('isRunning'), true);
  assert.equal(e.run('stepStatus.slotBooked'), false);
});

test('Save and Continue is recognized after preserving the selected mission and center', () => {
  const e = engine();
  e.run(`
    var mission = {selectedIndex:0,options:[{value:'existing',textContent:'Existing mission'}]};
    var center = {selectedIndex:0,options:[{value:'open',textContent:'Available IVAC'}]};
    first = selector => selector===PAGE.mission?mission:selector===PAGE.center?center:null;
    button = pattern => pattern.test('Save and Continue') ? {} : null;
    click = () => {clicks.push('save-and-continue');return true;};
    performMissionSelection(newStep(sample('mission')));
  `);
  assert.equal(e.run('clicks.join(",")'), 'save-and-continue');
});

test('payment detection stops before cleaning dialogs or clicking any final actions', () => {
  const e = calendarEngine();
  e.run(`
    isRunning = true;
    activeStep = bookingStep;
    first = selector => selector===PAGE.payment ? {} : null;
    executePopupCleanup = () => {throw Error('Must not dismiss a payment dialog');};
    executeWorkflowSteps();
  `);
  assert.equal(e.run('isRunning'), false);
  assert.equal(e.run('stepStatus.paymentReached'), true);
  assert.equal(e.run('stepStatus.slotBooked'), false);
  assert.equal(e.run('calendarClicks.length'), 0);
});

test('payment route is detected even before its form finishes rendering', () => {
  const e = engine();
  e.run(`window.location.pathname='/appointment/payment';`);
  assert.equal(e.run('paymentStageReached()'), true);
});

test('payment handoff has a clear final status with no working spinner', () => {
  const e = trackerEngine();
  e.run(`stepStatus.paymentReached=true; updateStepTrackerUI();`);
  assert.equal(e.run(`nodes['workflow-title'].textContent`), 'Payment / confirmation reached');
  assert.equal(e.run(`nodes['workflow-indicator'].className`), '');
  assert.equal(e.run(`nodes['workflow-indicator'].textContent`), '✓');
});

test('a form that posts to payment is not proof that the payment page was reached', () => {
  const e = engine();
  e.run(`first = selector => selector.includes('form[action') ? {} : null;`);
  assert.equal(e.run('paymentStageReached()'), false);
});

test('phone delivery is acknowledged after its code is submitted exactly once', () => {
  const e=otpEngine();
  e.run(`isRunning=true; performOTP(activeStep);
    messages[0].callback({ok:true,data:{success:true,otp:'123456',messageId:'11111111-1111-4111-8111-111111111111'}});
    performOTP(activeStep);performOTP(activeStep);`);
  assert.equal(e.run('clicks.length'),1);
  assert.equal(e.run(`messages.filter(item=>item.message.type==='PHONE_ACK_OTP').length`),1);
});
