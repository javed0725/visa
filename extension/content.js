// BLACK PANTHER — SLOT AUTOMATION: adaptive, completion-driven content script.
// Used by the complete Manifest V3 extension and as a drop-in content-script update.
let automatorInterval = null;
let isRunning = false;
let isPaused = false;
const FILE_SLOTS = [1, 2, 3, 4];
const FILE_SLOT_LABELS = { 1: 'PRIMARY PDF', 2: 'CO1', 3: 'CO2', 4: 'CO3' };
let uploadedFilesMap = { 1: null, 2: null, 3: null, 4: null };
let primarySlotKey = null;
const AUTOMATION_DEFAULTS = Object.freeze({
  autoSignIn: true,
  autoOtpFill: true,
  autoSubmitOtp: true,
  autoUploadPdf: true,
  autoClosePopups: true,
  autoSlotRotation: true,
  autoNavigate: true,
  autoMissionCenter: true,
  scanGapMs: 500,
  rate429BackoffMs: 25000,
  monthRange: 2,
  slotRotation: 'middle',
  preferredDate: ''
});
let automationSettings = { ...AUTOMATION_DEFAULTS };
let storageGeneration = 0;
let resetInProgress = false;
let currentStageDetail = '';
let currentStageName = 'Idle';
let panelCreating = false;
let otpSession = null;
let otpRequestVersion = 0;
let calendarResume = null;
let phoneStatusTimer = null;
// Visual history follows observed actions, never a presumed serial sequence.
const trackerHistory = [];
let cleanupPending = false;
const TRACKER_STEPS = [
  { kind: 'login', key: null, title: 'Open sign-in page' },
  { kind: 'signIn', key: 'signIn', id: 'step-sign-in', title: 'Sign in' },
  { kind: 'otp', key: 'otpVerified', id: 'step-otp', title: 'Verify OTP' },
  { kind: 'popups', key: 'popupsCleaned', id: 'step-popups', title: 'Clear popup' },
  { kind: 'appointment', key: 'takeAppointmentClicked', id: 'step-take-app', title: 'Take appointment' },
  { kind: 'upload', key: 'filesUploaded', id: 'step-upload', title: 'Upload documents' },
  { kind: 'details', key: null, title: 'Confirm applicant details' },
  { kind: 'mission', key: 'missionSelected', id: 'step-mission', title: 'Mission / center' },
  { kind: 'booking', key: 'slotBooked', id: 'step-booking', title: 'Book slot' },
  { kind: 'next', key: null, id: 'step-next', title: 'Continue popup' },
  { kind: 'details', key: 'detailsConfirmed', id: 'step-details', title: 'Confirm details' }
];
const ROADMAP = [
  { id: 'login', label: 'LOGIN', kinds: ['login', 'signIn'], done: ['signIn'] },
  { id: 'otp', label: 'OTP', kinds: ['otp'], done: ['otpVerified'] },
  { id: 'landing', label: 'LANDING', kinds: ['appointment'], done: ['takeAppointmentClicked'] },
  { id: 'notice', label: 'NOTICE', kinds: ['next'], done: ['noticeConfirmed'] },
  { id: 'upload', label: 'UPLOAD', kinds: ['upload'], done: ['filesUploaded'] },
  { id: 'co', label: 'CO', kinds: ['details'], done: ['detailsConfirmed'] },
  { id: 'mission', label: 'MISSION', kinds: ['mission'], done: ['missionSelected'] },
  { id: 'center', label: 'CENTER', kinds: ['mission'], done: ['centerSelected'] },
  { id: 'date', label: 'DATE', kinds: ['booking'], done: ['slotBooked', 'dateContinued'] },
  { id: 'pay', label: 'PAY', kinds: [], done: ['paymentReached'] }
];

// Step Completion Tracking State
let stepStatus = {
  signIn: false,
  otpVerified: false,
  popupsCleaned: false,
  takeAppointmentClicked: false,
  filesUploaded: false,
  missionSelected: false,
  centerSelected: false,
  noticeConfirmed: false,
  detailsConfirmed: false,
  dateContinued: false,
  slotBooked: false,
  paymentReached: false
};

function normalizeAutomationSettings(raw = {}) {
  const values = { ...AUTOMATION_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  for (const key of [
    'autoSignIn', 'autoOtpFill', 'autoSubmitOtp', 'autoUploadPdf', 'autoClosePopups',
    'autoSlotRotation', 'autoNavigate', 'autoMissionCenter'
  ]) values[key] = values[key] !== false;
  values.scanGapMs = Math.max(100, Math.min(30000, Number(values.scanGapMs) || AUTOMATION_DEFAULTS.scanGapMs));
  values.rate429BackoffMs = Math.max(1000, Math.min(120000, Number(values.rate429BackoffMs) || AUTOMATION_DEFAULTS.rate429BackoffMs));
  values.monthRange = Math.max(1, Math.min(12, Math.round(Number(values.monthRange) || AUTOMATION_DEFAULTS.monthRange)));
  values.slotRotation = ['forward', 'backward'].includes(values.slotRotation) ? values.slotRotation : 'middle';
  values.preferredDate = /^\d{4}-\d{2}-\d{2}$/.test(String(values.preferredDate || '')) ? String(values.preferredDate) : '';
  return values;
}

function syncAutomationControls() {
  document.querySelectorAll('#visa-automator-floating-panel [data-setting]').forEach(control => {
    const value = automationSettings[control.dataset.setting];
    if (control.type === 'checkbox') control.checked = !!value;
    else control.value = value ?? '';
  });
  updateStepTrackerUI();
  updateDebugPanel();
}

function setAutomationSetting(key, value) {
  if (!(key in AUTOMATION_DEFAULTS)) return false;
  automationSettings = normalizeAutomationSettings({ ...automationSettings, [key]: value });
  chrome.storage.local.set({ automationSettings });
  syncAutomationControls();
  return true;
}

function initAutomationControls(saved = {}) {
  automationSettings = normalizeAutomationSettings(saved);
  syncAutomationControls();
  document.querySelectorAll('#visa-automator-floating-panel [data-setting]').forEach(control => {
    const save = () => setAutomationSetting(control.dataset.setting,
      control.type === 'checkbox' ? control.checked : control.value);
    control.addEventListener('change', save);
  });
}

function populateConfigSelect(select, selector, placeholder, savedValue) {
  if (!select) return;
  const previous = savedValue || select.value;
  const found = Array.from(document.querySelectorAll(selector)).filter(el => visible(el) && el.options)
    .flatMap(el => Array.from(el.options))
    .filter(usableOption)
    .map(option => ({ value: option.value, label: option.textContent.trim() }));
  if (selector === PAGE.center) {
    const custom = customCenter();
    const listId = custom?.getAttribute('aria-controls');
    const list = listId ? document.getElementById(listId) : first('[role="listbox"]');
    if (list && !inPanel(list)) {
      found.push(...all('[role="option"]', list).filter(enabled).map(option => ({
        value: option.getAttribute('data-value') || label(option),
        label: label(option)
      })));
    }
  }
  const unique = [...new Map(found.filter(option => option.label && option.value !== '')
    .map(option => [`${option.value}\u0000${option.label}`, option])).values()];
  select.replaceChildren(new Option(placeholder, ''));
  unique.forEach(option => select.add(new Option(option.label, option.value)));
  if (previous && unique.some(option => option.value === previous || option.label === previous)) {
    select.value = unique.find(option => option.value === previous || option.label === previous).value;
  } else {
    select.value = '';
  }
}

function refreshConfigDropdowns(savedMission, savedCenter) {
  if (typeof PAGE === 'undefined') return;
  populateConfigSelect(document.getElementById('config-mission'), PAGE.mission,
    'Use current page selection', savedMission);
  populateConfigSelect(document.getElementById('config-center'), PAGE.center,
    'Choose from current page options', savedCenter);
  updateDebugPanel();
}

// Helper: Convert File to Base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
    reader.onerror = error => reject(error);
  });
}

// Helper: Convert Base64 back to File
function base64ToFile(fileObj) {
  if (!fileObj || !fileObj.data) return null;
  const arr = fileObj.data.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], fileObj.name, { type: mime });
}

function createFloatingPanel() {
  if (panelCreating || document.getElementById('visa-automator-floating-panel')) return;
  panelCreating = true;
  const generation = storageGeneration;

  chrome.storage.local.get(['panelPos', 'savedPhone', 'savedPass', 'primarySlot', 'savedMission', 'savedCenter', 'savedFilesMap', 'automatorRunning', 'calendarRetry', 'automationSettings'], async (result) => {
    panelCreating = false;
    if (generation !== storageGeneration || resetInProgress) return;
    const posX = result.panelPos?.x || '30px';
    const posY = result.panelPos?.y || '30px';
    const isRight = result.panelPos?.right !== undefined ? result.panelPos.right : '30px';
    if (result.primarySlot) primarySlotKey = result.primarySlot;
    automationSettings = normalizeAutomationSettings(result.automationSettings);
    calendarResume = result.calendarRetry || null;

    if (result.savedFilesMap) {
      FILE_SLOTS.forEach(slot => {
        if (result.savedFilesMap[slot]) uploadedFilesMap[slot] = base64ToFile(result.savedFilesMap[slot]);
      });
    }

    const panelHTML = `
      <div id="visa-automator-floating-panel" class="bp-shell" style="position:fixed;top:${posY};right:${isRight};left:${posX};">
        <div id="panel-header">
          <div class="bp-brand">
            <span class="bp-mark" aria-hidden="true">
              <svg viewBox="0 0 128 128" width="28" height="28" role="img" focusable="false">
                <path d="M20 18 45 29 64 22 83 29 108 18 103 45 115 67 102 99 64 116 26 99 13 67 25 45Z" fill="#080d15" stroke="#55e6e1" stroke-width="5" stroke-linejoin="round"/>
                <path d="m27 45 20 10 17-7 17 7 20-10-7 32-30 24-30-24Z" fill="#151326" stroke="#b49aff" stroke-width="3.5" stroke-linejoin="round"/>
                <path d="m32 56 20 6 12-6 12 6 20-6-9 13-17 5-6-5-6 5-17-5Z" fill="#55e6e1"/>
                <path d="m58 74 6 4 6-4-3 12-3 3-3-3Z" fill="#b49aff"/>
                <path d="m44 89 12 5 8-7 8 7 12-5-8 15-12 6-12-6Z" fill="#0a1119" stroke="#55e6e1" stroke-width="2.5" stroke-linejoin="round"/>
              </svg>
            </span>
            <span class="bp-title">BLACK PANTHER — SLOT AUTOMATION</span>
            <span class="bp-version">v2.3.1</span>
          </div>
          <div class="bp-header-actions">
            <span id="panel-run-state" class="bp-run-state" data-state="idle">IDLE</span>
            <button id="reset-panel" title="Stop automation and erase all saved extension data">RESET</button>
            <button id="minimize-panel" aria-label="Minimize panel">−</button>
            <button id="close-panel" aria-label="Close panel">×</button>
          </div>
        </div>
        <div id="panel-content">
          <nav class="bp-tabs" aria-label="Extension sections">
            <button id="tab-run-btn" class="bp-tab" aria-selected="true">RUN</button>
            <button id="tab-config-btn" class="bp-tab" aria-selected="false">CONFIG</button>
            <button id="tab-log-btn" class="bp-tab" aria-selected="false">LOG</button>
            <button id="tab-debug-btn" class="bp-tab" aria-selected="false">DEBUG</button>
          </nav>

          <div id="view-run" class="tab-view">
            <section class="bp-section">
              <div class="bp-section-heading"><span>LIVE ROADMAP</span><span>LOGIN → PAY</span></div>
              <div data-bp="roadmap" aria-label="10-step workflow roadmap">
                ${ROADMAP.map((step, index) => `<div data-roadmap-id="${step.id}" data-bp-step="upcoming" data-step="${index + 1}" title="${step.label}">${step.label}</div>`).join('')}
              </div>
            </section>
            <div class="bp-credentials">
              <label>PHONE<input type="text" id="phone-field" placeholder="Phone number" autocomplete="username"></label>
              <label>PASSWORD<input type="password" id="pass-field" placeholder="Password" autocomplete="current-password"></label>
            </div>
            <section class="bp-section bp-phone-card">
              <label class="bp-check"><input id="phone-otp-toggle" type="checkbox"> Link phone relay</label>
              <div class="bp-client-key-row">
                <input id="phone-client-key" aria-label="Client Key" readonly placeholder="CLIENT KEY">
                <button id="phone-copy-key" title="Copy Client Key">COPY</button>
                <button id="phone-new-key" title="Regenerate key and unpair the old phone">NEW</button>
              </div>
              <div class="bp-inline-note"><span id="phone-pair-status" role="status">Not paired</span><button id="phone-relay-setup">RELAY SETUP</button></div>
            </section>
            <div class="bp-otp-row">
              <input type="text" id="otp-input-field" aria-label="OTP" placeholder="ENTER OTP" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
              <button id="send-otp-btn">FETCH OTP</button>
              <button id="fill-otp-btn" title="Fetch the latest relay OTP and fill the page without submitting it">FILL OTP</button>
            </div>
            <div class="bp-run-controls">
              <button id="start-btn">▶ START</button>
              <button id="pause-btn">Ⅱ PAUSE</button>
              <button id="stop-btn">■ STOP</button>
            </div>
            <section data-bp="quick-actions" aria-label="Quick fixes">
              <button data-bp-action="fix-upload" id="fix-upload-btn">FIX UPLOAD</button>
              <button data-bp-action="fix-otp" id="fix-otp-btn">FIX OTP</button>
              <button data-bp-action="fix-cf" id="fix-cf-btn">FIX CF</button>
              <button data-bp-action="resume" id="force-resume-btn">FORCE RESUME</button>
            </section>
            <section class="bp-section bp-files">
              <div class="bp-section-heading"><span>DOCUMENTS · PDF ≤ 500 KB</span><span id="webfile-status-count">0 / 4</span></div>
              <div class="bp-file-grid">
                ${FILE_SLOTS.map(slot => `<div class="bp-file-slot">
                  <button class="webfile-slot-btn" data-slot="${slot}">${FILE_SLOT_LABELS[slot]}</button>
                  <button class="primary-toggle-btn" data-slot="${slot}" aria-label="Make ${FILE_SLOT_LABELS[slot]} primary">${primarySlotKey == slot ? '★ PRIMARY' : 'MAKE PRIMARY'}</button>
                </div>`).join('')}
              </div>
              ${FILE_SLOTS.map(slot => `<input type="file" id="slot-file-${slot}" class="hidden-slot-input" data-slot="${slot}" accept=".pdf,application/pdf" hidden>`).join('')}
              <div id="slot-names-display">Primary PDF uploads first; additional applicant files follow.</div>
            </section>
            <section data-bp="status-card" class="bp-status-card">
              <div class="bp-section-heading"><span id="manual-file-quick-status">WORKFLOW STATUS</span><span id="panel-stage-label">READY</span></div>
              <div id="workflow-status" role="status" aria-live="polite" aria-atomic="true" aria-busy="false">
                <span id="workflow-indicator" aria-hidden="true">•</span>
                <div class="bp-status-copy"><b id="workflow-title">Ready</b><div id="workflow-detail">Press Start to detect the current page step.</div></div>
                <button id="workflow-retry" hidden>RETRY</button>
              </div>
            </section>
            <div data-bp="metrics" aria-label="Automation metrics">
              <div data-bp-metric>TRIES<strong id="metric-attempts">0</strong></div>
              <div data-bp-metric>CYCLE<strong id="metric-cycle">1</strong></div>
              <div data-bp-metric>DATES<strong id="metric-dates">0</strong></div>
              <div data-bp-metric>NEXT<strong id="metric-next">—</strong></div>
            </div>
            <div class="bp-telemetry">
              <div>STAGE<strong id="metric-stage">Idle</strong></div>
              <div>PREFERRED<strong id="metric-preferred">Any</strong></div>
              <div>AVAILABLE<strong id="metric-available">—</strong></div>
              <div>TRYING<strong id="metric-trying">—</strong></div>
            </div>
          </div>

          <div id="view-config" class="tab-view" hidden>
            <section class="bp-section">
              <div class="bp-section-heading">MISSION &amp; CENTER</div>
              <label>MISSION<select id="config-mission"><option value="">Use current page selection</option></select></label>
              <label>IVAC CENTER<select id="config-center"><option value="">Choose from current page options</option></select></label>
              <p class="bp-note">Options are read from the official page when its selectors are available. Mission changes are off by default; current page selection is preserved.</p>
            </section>
            <section class="bp-section">
              <div class="bp-section-heading">DATES &amp; SCAN</div>
              <label>PREFERRED DATE<input type="date" id="setting-preferredDate" data-setting="preferredDate"></label>
              <div class="bp-config-grid">
                <label>SCAN GAP (MS)<input type="number" min="100" max="30000" step="100" data-setting="scanGapMs"></label>
                <label>429 BACKOFF (MS)<input type="number" min="1000" max="120000" step="1000" data-setting="rate429BackoffMs"></label>
                <label>MONTH RANGE<input type="number" min="1" max="12" step="1" data-setting="monthRange"></label>
                <label>DATE ROTATION<select data-setting="slotRotation"><option value="middle">Middle-first</option><option value="backward">Backward</option><option value="forward">Forward</option></select></label>
              </div>
            </section>
            <section class="bp-section">
              <div class="bp-section-heading">AUTOMATION MATRIX</div>
              <div class="bp-toggle-grid">
                <label class="bp-check"><input type="checkbox" data-setting="autoSignIn"> Auto sign-in</label>
                <label class="bp-check"><input type="checkbox" data-setting="autoOtpFill"> Auto OTP fill</label>
                <label class="bp-check"><input type="checkbox" data-setting="autoSubmitOtp"> Auto-submit OTP</label>
                <label class="bp-check"><input type="checkbox" data-setting="autoUploadPdf"> Auto upload PDF</label>
                <label class="bp-check"><input type="checkbox" data-setting="autoClosePopups"> Auto close popups</label>
                <label class="bp-check"><input type="checkbox" data-setting="autoSlotRotation"> Auto slot rotation</label>
                <label class="bp-check"><input type="checkbox" data-setting="autoNavigate"> Auto navigate</label>
                <label class="bp-check"><input type="checkbox" data-setting="autoMissionCenter"> Auto mission/center</label>
              </div>
            </section>
            <section class="bp-section bp-payment-note">
              <div class="bp-section-heading">PAYMENT HANDOFF</div>
              <p>Payment remains manual on the official page. This extension does not collect or store a bKash PIN and will not submit a payment.</p>
            </section>
            <button id="reset-config-btn" class="bp-secondary-btn">RESET AUTOMATION SETTINGS</button>
          </div>

          <div id="view-log" class="tab-view" hidden>
            <div class="bp-log-heading"><strong>SESSION LOG</strong><button id="clear-log-btn">CLEAR</button></div>
            <div id="va-log-list" role="log" aria-live="polite"></div>
          </div>

          <div id="view-debug" class="tab-view" hidden>
            <section class="bp-section">
              <div class="bp-section-heading">LIVE DIAGNOSTICS</div>
              <dl class="bp-debug-list">
                <dt>Runtime</dt><dd id="debug-runtime">Checking…</dd>
                <dt>Detected step</dt><dd id="debug-step">—</dd>
                <dt>Page selectors</dt><dd id="debug-selectors">—</dd>
                <dt>Files loaded</dt><dd id="debug-files">0 / 4</dd>
                <dt>Phone relay</dt><dd id="debug-relay">—</dd>
                <dt>Automation</dt><dd id="debug-settings">—</dd>
              </dl>
              <p class="bp-note">Diagnostics never display your password, OTP, file contents, Client Key, or payment credentials.</p>
              <button id="debug-rescan-btn" class="bp-secondary-btn">RESCAN PAGE</button>
            </section>
          </div>
        </div>
      </div>
    `;

    const div = document.createElement('div');
    div.innerHTML = panelHTML;
    document.body.appendChild(div);
    document.getElementById('phone-field').value = result.savedPhone || '';
    document.getElementById('pass-field').value = result.savedPass || '';
    initAutomationControls(result.automationSettings);
    compactPanel(document.getElementById('visa-automator-floating-panel'));

    updateSlotDisplayStatus();
    updateStepTrackerUI();
    refreshConfigDropdowns(result.savedMission, result.savedCenter);

    const missionSelect = document.getElementById('config-mission');
    const centerSelect = document.getElementById('config-center');

    document.getElementById('phone-field').addEventListener('input', (e) => {
      chrome.storage.local.set({ savedPhone: e.target.value });
    });
    document.getElementById('pass-field').addEventListener('input', (e) => {
      chrome.storage.local.set({ savedPass: e.target.value });
    });
    if (missionSelect) {
      missionSelect.addEventListener('change', (e) => {
        chrome.storage.local.set({ savedMission: e.target.value });
      });
    }
    if (centerSelect) {
      centerSelect.addEventListener('change', (e) => {
        chrome.storage.local.set({ savedCenter: e.target.value });
      });
    }

    // Tab Switching
    [['RUN', 'tab-run-btn'], ['CONFIG', 'tab-config-btn'], ['LOG', 'tab-log-btn'], ['DEBUG', 'tab-debug-btn']]
      .forEach(([name, id]) => document.getElementById(id).addEventListener('click', () => switchTab(name, id)));

    function switchTab(tabName, btnId) {
      document.querySelectorAll('.tab-view').forEach(el => { el.hidden = true; });
      document.querySelectorAll('.bp-tab').forEach(button => button.setAttribute('aria-selected', 'false'));
      document.getElementById(`view-${tabName.toLowerCase()}`).hidden = false;
      document.getElementById(btnId).setAttribute('aria-selected', 'true');
      if (tabName === 'DEBUG') updateDebugPanel();
    }

    document.getElementById('reset-config-btn').addEventListener('click', () => {
      automationSettings = { ...AUTOMATION_DEFAULTS };
      chrome.storage.local.set({ automationSettings });
      syncAutomationControls();
      logMessage('Automation settings restored to defaults.');
    });
    document.getElementById('clear-log-btn').addEventListener('click', () => {
      document.getElementById('va-log-list').replaceChildren();
      logMessage('Session log cleared.');
    });
    document.getElementById('debug-rescan-btn').addEventListener('click', () => {
      refreshConfigDropdowns();
      updateDebugPanel();
      if (isRunning) scheduleWorkflow(0);
    });
    document.getElementById('fix-upload-btn').addEventListener('click', () => {
      const candidate = fileInputs().find(input => !input.disabled);
      if (candidate) {
        candidate.scrollIntoView({ block: 'center', behavior: 'smooth' });
        candidate.focus?.();
        updateStage('Upload check', '70%', 'Upload field found. Complete any site security check manually.');
      } else {
        document.getElementById(`slot-file-${primarySlotKey || 1}`)?.click();
        updateStage('Upload check', '70%', 'Choose or replace the primary PDF, then resume.');
      }
      logMessage('Upload recovery check opened; no site validation was bypassed.');
    });
    document.getElementById('fix-otp-btn').addEventListener('click', () => {
      const field = first(PAGE.otp);
      if (!field) {
        updateStage('OTP check', '30%', 'OTP field is not visible yet; the detector will keep watching.');
      } else {
        field.scrollIntoView({ block: 'center', behavior: 'smooth' });
        field.focus();
        pollOTPFromBackground();
      }
      if (isRunning) scheduleWorkflow(0);
    });
    document.getElementById('fix-cf-btn').addEventListener('click', () => {
      const captcha = first(PAGE.captcha);
      if (captcha) {
        captcha.scrollIntoView({ block: 'center', behavior: 'smooth' });
        updateStage('Security check', '65%', 'Complete the official security challenge manually; the extension will detect its verified response.');
      } else {
        updateStage('Security check', '65%', 'No CAPTCHA is currently visible. The page will be rechecked.');
        if (isRunning) scheduleWorkflow(0);
      }
      logMessage('Security check re-scan requested; CAPTCHA remains manual.');
    });
    document.getElementById('force-resume-btn').addEventListener('click', () => {
      if (!isRunning) startAutomation();
      if (activeStep && !activeStep.submitted && activeStep.kind !== 'otp') activeStep.nextTry = 0;
      if (popupContinuation && !popupContinuation.submitted) popupContinuation.nextTry = 0;
      updateStage('Resuming', '20%', 'Rescanning the current page without bypassing CAPTCHA, upload checks, or confirmations.');
      scheduleWorkflow(0);
    });

    document.getElementById('workflow-retry').addEventListener('click', () => {
      if (activeStep) runManualStep(activeStep.kind);
    });
    document.getElementById('reset-panel').addEventListener('click', async () => {
      if (!window.confirm('Stop automation and permanently erase all saved extension inputs, files and settings?')) return;
      resetPanelState();
      resetInProgress = true;
      try {
        const response = await chrome.runtime.sendMessage({ type: 'RESET_AUTOMATOR' });
        if (!response?.ok) throw new Error(response?.error || 'Reset failed');
        logMessage('All saved extension data was cleared.');
        if (response.warning) logMessage(response.warning);
      } catch (error) {
        logMessage(`Storage reset failed: ${error.message}`);
        currentStageDetail = 'Reset failed. Please try RESET again.';
      } finally {
        resetInProgress = false;
        updateStepTrackerUI();
      }
    });

    document.querySelectorAll('.webfile-slot-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const slotNum = btn.getAttribute('data-slot');
        document.getElementById(`slot-file-${slotNum}`).click();
      });
    });

    document.querySelectorAll('.hidden-slot-input').forEach(input => {
      input.addEventListener('change', async (e) => {
        const slotNum = e.target.getAttribute('data-slot');
        const file = e.target.files[0];
        if (file) {
          const generation = storageGeneration;
          uploadedFilesMap[slotNum] = file;
          const slotBtn = document.querySelector(`.webfile-slot-btn[data-slot="${slotNum}"]`);
          slotBtn.style.background = slotNum == primarySlotKey ? '#00b359' : '#28293d';
          slotBtn.style.color = '#fff';
          updateSlotDisplayStatus();
          logMessage(`${FILE_SLOT_LABELS[slotNum]} loaded: ${file.name}`);

          try {
            const base64Data = await fileToBase64(file);
            if (generation !== storageGeneration || resetInProgress) return;
            chrome.storage.local.get(['savedFilesMap'], (res) => {
              if (generation !== storageGeneration || resetInProgress) return;
              const currentMap = res.savedFilesMap || {};
              currentMap[slotNum] = base64Data;
              chrome.storage.local.set({ savedFilesMap: currentMap });
            });
          } catch (err) {
            console.error('File storage error:', err);
          }
        }
      });
    });

    document.querySelectorAll('.primary-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const slotNum = btn.getAttribute('data-slot');
        primarySlotKey = slotNum;
        chrome.storage.local.set({ primarySlot: slotNum });

        document.querySelectorAll('.primary-toggle-btn').forEach(b => {
          b.style.background = '#161722';
          b.style.color = '#666';
          b.innerText = 'MAKE PRIMARY';
        });
        document.querySelectorAll('.webfile-slot-btn').forEach(b => {
          b.style.background = '#161722';
        });

        btn.style.background = '#00b35922';
        btn.style.color = '#00ff88';
        btn.innerText = '★ PRIMARY';

        const activeSlotBtn = document.querySelector(`.webfile-slot-btn[data-slot="${slotNum}"]`);
        if (uploadedFilesMap[slotNum]) activeSlotBtn.style.background = '#00b359';
        document.querySelectorAll('.webfile-slot-btn').forEach(b => {
          b.textContent = FILE_SLOT_LABELS[b.dataset.slot];
        });
        updateSlotDisplayStatus();

        logMessage(`${FILE_SLOT_LABELS[slotNum]} set as the primary PDF.`);
      });
    });

    const panel = document.getElementById('visa-automator-floating-panel');
    const header = document.getElementById('panel-header');
    let isDragging = false, startX, startY;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      startX = e.clientX - panel.offsetLeft;
      startY = e.clientY - panel.offsetTop;
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const newX = (e.clientX - startX) + 'px';
      const newY = (e.clientY - startY) + 'px';
      panel.style.left = newX;
      panel.style.top = newY;
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        chrome.storage.local.set({
          panelPos: { x: panel.style.left, y: panel.style.top }
        });
      }
    });

    document.getElementById('close-panel').addEventListener('click', () => {
      stopAutomation();
      panel.remove();
    });
    document.getElementById('minimize-panel').addEventListener('click', () => {
      const content = document.getElementById('panel-content');
      content.hidden = !content.hidden;
    });

    document.getElementById('start-btn').addEventListener('click', () => {
      if (!isRunning) {
        startAutomation();
        chrome.storage.local.set({ automatorRunning: true });
      }
    });

    document.getElementById('pause-btn').addEventListener('click', () => {
      if (isRunning) stopAutomation(true);
      else if (isPaused) startAutomation();
    });

    document.getElementById('stop-btn').addEventListener('click', () => {
      stopAutomation();
      chrome.storage.local.set({ automatorRunning: false });
    });

    document.getElementById('send-otp-btn').addEventListener('click', () => {
      pollOTPFromBackground();
    });
    document.getElementById('fill-otp-btn').addEventListener('click', () => {
      pollOTPFromBackground(false, { force: true, fillOnly: true });
    });
    document.getElementById('otp-input-field').addEventListener('input', () => {
      const session = getOTPSession();
      session.revision++;
      scheduleWorkflow(0);
    });
    initPhoneControls();
    if (result.automatorRunning) startAutomation();
  });
}
function renderPhoneState(state = {}) {
  const toggle = document.getElementById('phone-otp-toggle');
  const key = document.getElementById('phone-client-key');
  const text = document.getElementById('phone-pair-status');
  if (toggle) toggle.checked = !!state.enabled;
  if (key) key.value = state.clientKey || '';
  if (text) text.textContent = state.error || (!state.clientKey ? 'Open Relay setup to pair your phone.' :
    state.expiresAt && Date.now() >= state.expiresAt ? 'Pairing expired. Generate a new key.' :
    state.paired ? (state.enabled ? 'Phone paired · auto-fill on' : 'Phone paired · auto-fill off') :
    state.pairExpiresAt && Date.now() >= state.pairExpiresAt ? 'Key expired. Generate a new key.' :
    'Enter this key in the Android app within 10 minutes.');
}
function initPhoneControls() {
  const message = async payload => {
    const response = await chrome.runtime.sendMessage(payload);
    if (!response?.ok) throw Error(response?.error || 'Extension connection unavailable');
    if (!phoneStatusTimer && response.state?.clientKey) phoneStatusTimer = setInterval(refresh, 5000);
    return response.state;
  };
  const refresh = async () => {
    if (!document.getElementById('phone-pair-status') || resetInProgress) return;
    const generation = storageGeneration;
    try {
      const state = await message({ type: 'PHONE_STATE' });
      if (generation === storageGeneration && !resetInProgress) renderPhoneState(state);
    } catch (error) {
      if (generation === storageGeneration && !resetInProgress) document.getElementById('phone-pair-status').textContent = error.message;
    }
  };
  const toggle = document.getElementById('phone-otp-toggle');
  toggle.addEventListener('change', async () => {
    const enabled = toggle.checked;
    const generation = storageGeneration;
    toggle.disabled = true;
    otpRequestVersion++; // A late in-flight response must not defeat the switch.
    if (otpSession) otpSession.fetchPending = false;
    try {
      const state = await message({ type: 'PHONE_ENABLE', enabled });
      if (generation === storageGeneration && !resetInProgress) { renderPhoneState(state); scheduleWorkflow(0); }
    }
    catch (error) {
      if (generation === storageGeneration && !resetInProgress) {
        toggle.checked = !enabled; document.getElementById('phone-pair-status').textContent = error.message;
      }
    }
    finally { toggle.disabled = false; }
  });
  document.getElementById('phone-relay-setup').addEventListener('click', () => {
    void message({ type: 'PHONE_SETUP' }).catch(error => { document.getElementById('phone-pair-status').textContent = error.message; });
  });
  document.getElementById('phone-copy-key').addEventListener('click', async () => {
    const key = document.getElementById('phone-client-key');
    if (!key.value) return;
    try { await navigator.clipboard.writeText(key.value); document.getElementById('phone-pair-status').textContent = 'Client Key copied.'; }
    catch { key.select(); document.getElementById('phone-pair-status').textContent = 'Press Ctrl+C to copy the selected key.'; }
  });
  document.getElementById('phone-new-key').addEventListener('click', async event => {
    if (!window.confirm('Regenerate the Client Key? This disconnects the old phone and erases its pending OTP. Pair your phone again with the new key.')) return;
    const button = event.currentTarget;
    const generation = storageGeneration;
    button.disabled = true;
    otpRequestVersion++;
    if (otpSession) otpSession.fetchPending = false;
    try {
      const state = await message({ type: 'PHONE_REGENERATE' });
      if (generation === storageGeneration && !resetInProgress) renderPhoneState(state);
    }
    catch (error) {
      if (generation === storageGeneration && !resetInProgress) document.getElementById('phone-pair-status').textContent = error.message;
    }
    finally { button.disabled = false; }
  });
  if (phoneStatusTimer) clearInterval(phoneStatusTimer);
  phoneStatusTimer = setInterval(refresh, 5000);
  void refresh();
}

function updateSlotDisplayStatus() {
  const count = FILE_SLOTS.filter(slot => uploadedFilesMap[slot]).length;

  const countLbl = document.getElementById('webfile-status-count');
  if (countLbl) countLbl.innerText = `${count} / 4`;

  const quickStatus = document.getElementById('manual-file-quick-status');
  if (quickStatus) quickStatus.innerText = `FILES ${count}/4`;
  const debugFiles = document.getElementById('debug-files');
  if (debugFiles) debugFiles.textContent = `${count} / 4`;

  const statusDesc = document.getElementById('slot-names-display');
  if (statusDesc) {
    let names = [];
    FILE_SLOTS.forEach(k => {
      if (uploadedFilesMap[k]) {
         let label = `${FILE_SLOT_LABELS[k]}: ${uploadedFilesMap[k].name}${k == primarySlotKey ? ' ★' : ''}`;
        names.push(label);
      }
    });
    statusDesc.innerText = names.length > 0 ? names.join(' · ') : 'Primary PDF uploads first; additional applicant files follow.';
  }
}

function updateStepTrackerUI() {
  const box = document.getElementById('workflow-status');
  const current = cleanupPending ? 'popups' : popupContinuation?.kind || activeStep?.kind;
  const working = isRunning && !resetInProgress;
  const complete = stepStatus.paymentReached;
  const title = resetInProgress ? 'Resetting…' : complete ? 'Payment / confirmation reached' :
    TRACKER_STEPS.find(item => item.kind === current)?.title ||
    (isPaused ? 'Paused' : isRunning ? 'Detecting current step' : 'Ready');
  const runState = document.getElementById('panel-run-state');
  if (runState) {
    runState.textContent = complete ? 'MANUAL PAYMENT' : isPaused ? 'PAUSED' : isRunning ? 'RUNNING' : 'IDLE';
    runState.dataset.state = complete ? 'manual' : isPaused ? 'paused' : isRunning ? 'running' : 'idle';
  }
  const stageLabel = document.getElementById('panel-stage-label');
  if (stageLabel) stageLabel.textContent = (currentStageName || title).toUpperCase();
  const pauseButton = document.getElementById('pause-btn');
  if (pauseButton) pauseButton.textContent = isPaused ? '▶ RESUME' : 'Ⅱ PAUSE';
  const stageMetric = document.getElementById('metric-stage');
  if (stageMetric) stageMetric.textContent = currentStageName || title;
  const preferredMetric = document.getElementById('metric-preferred');
  if (preferredMetric) preferredMetric.textContent = automationSettings.preferredDate || 'Any';
  document.querySelectorAll('[data-roadmap-id]').forEach(el => {
    const item = ROADMAP.find(step => step.id === el.dataset.roadmapId);
    const done = item?.done.some(key => !!stepStatus[key]);
    const active = !done && item?.kinds.includes(current);
    el.dataset.bpStep = done ? 'complete' : active ? 'active' : 'upcoming';
    el.setAttribute('aria-current', active ? 'step' : 'false');
  });
  if (!box) {
    updateDebugPanel();
    return;
  }
  const step = TRACKER_STEPS.find(item => item.kind === current);
  const last = [...trackerHistory].reverse().find(kind => {
    const item = TRACKER_STEPS.find(s => s.kind === kind);
    return item?.key ? stepStatus[item.key] : kind === 'next' && trackerNextComplete;
  });
  document.getElementById('workflow-title').textContent = title;
  document.getElementById('workflow-detail').textContent = resetInProgress ? 'Clearing all saved extension data…' :
    isPaused ? 'Paused on the current page. Press Resume to continue.' :
    !isRunning && current ? 'Stopped. Press Start to resume detection.' :
    currentStageDetail || (working ? 'Watching the page for available elements…' :
    (complete || last) ? 'Review and continue manually on the official payment page.' : 'Press Start to detect the current step.');
  const indicator = document.getElementById('workflow-indicator');
  indicator.className = working || resetInProgress ? 'va-working' : '';
  indicator.textContent = working || resetInProgress ? '' : complete ? '✓' : '•';
  box.setAttribute('aria-busy', String(working || resetInProgress));
  const retry = document.getElementById('workflow-retry');
  retry.hidden = !activeStep || working || resetInProgress;
  retry.disabled = resetInProgress;
  updateDebugPanel();
}

function compactPanel(panel) {
  const properties = ['fontSize', 'padding', 'margin', 'marginBottom', 'marginTop', 'gap',
    'borderRadius', 'height', 'minHeight', 'maxHeight', 'letterSpacing'];
  for (const el of panel.querySelectorAll('[style]')) {
    const hasMargin = !!el.style.margin;
    for (const property of properties) {
      if (hasMargin && ['marginTop', 'marginBottom'].includes(property)) continue;
      const value = el.style[property];
      if (value?.includes('px')) el.style[property] = value.replace(/([\d.]+)px/g, (_, n) => `${(Number(n) * 0.82).toFixed(2)}px`);
    }
  }
  const content = panel.querySelector('#panel-content');
  content.style.maxHeight = `${Math.max(100, Math.min(484, window.innerHeight - 72))}px`;
  const rect = panel.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - 48))}px`;
  panel.style.right = 'auto';
}

function resetPanelState() {
  // Invalidate async file readers and fetched OTPs before clearing persistent data.
  storageGeneration++;
  clearOTPSession();
  if (phoneStatusTimer) clearInterval(phoneStatusTimer);
  phoneStatusTimer = null;
  renderPhoneState();
  isRunning = false;
  isPaused = false;
  clearTimeout(automatorInterval);
  automatorInterval = null;
  workflowObserver?.disconnect();
  workflowObserver = null;
  activeStep = null;
  calendarResume = null;
  popupContinuation = null;
  cleanupPending = false;
  trackerHistory.length = 0;
  trackerNextComplete = false;
  for (const key of Object.keys(stepStatus)) stepStatus[key] = false;
  automationSettings = { ...AUTOMATION_DEFAULTS };
  uploadedFilesMap = { 1: null, 2: null, 3: null, 4: null };
  primarySlotKey = null;
  attemptCount = 0;
  currentStageDetail = '';
  currentStageName = 'Ready';
  const panel = document.getElementById('visa-automator-floating-panel');
  if (panel) {
    panel.querySelectorAll('input, select').forEach(el => {
      if (el.type === 'checkbox') el.checked = false;
      else if (!el.matches('[data-setting]')) el.value = '';
    });
    syncAutomationControls();
    panel.querySelectorAll('.webfile-slot-btn').forEach(el => {
      el.textContent = FILE_SLOT_LABELS[el.dataset.slot];
      el.style.background = '#161722';
      el.style.color = '#aaa';
    });
    panel.querySelectorAll('.primary-toggle-btn').forEach(el => {
      el.textContent = 'Make Primary';
      el.style.background = '#161722';
      el.style.color = '#666';
    });
    panel.style.left = '16px';
    panel.style.top = '16px';
    const log = panel.querySelector('#va-log-list');
    if (log) log.replaceChildren();
  }
  for (const [id, value] of [['metric-attempts', '0'], ['metric-cycle', '1'], ['metric-dates', '0'], ['metric-next', '-']]) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }
  updateSlotDisplayStatus();
  updateStage('Ready', '0%', '');
  updateStepTrackerUI();
}

function revealTrackerStep(kind) {
  if (!trackerHistory.includes(kind)) trackerHistory.push(kind);
}
let trackerNextComplete = false;

function logMessage(msg) {
  const logBoxes = document.querySelectorAll('#va-log-list');
  for (const logBox of logBoxes) {
    const entry = document.createElement('div');
    entry.className = 'bp-log-entry';
    entry.textContent = `${new Date().toLocaleTimeString()} · ${msg}`;
    logBox.appendChild(entry);
    while (logBox.children.length > 150) logBox.firstElementChild.remove();
    logBox.scrollTop = logBox.scrollHeight;
  }
  updateDebugPanel();
}

function updateDebugPanel() {
  const set = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  const visibleSelects = typeof PAGE !== 'undefined' ? all(`${PAGE.mission}, ${PAGE.center}`).length : 0;
  const visibleUploads = typeof PAGE !== 'undefined' ? fileInputs().length : 0;
  const relayText = document.getElementById('phone-pair-status')?.textContent?.trim() || 'Not paired';
  set('debug-runtime', isRunning ? 'Active observer' : isPaused ? 'Paused' : 'Idle');
  set('debug-step', activeStep?.kind || popupContinuation?.kind || 'No active step');
  set('debug-selectors', `${visibleSelects} mission/center · ${visibleUploads} upload fields`);
  set('debug-files', `${FILE_SLOTS.filter(slot => uploadedFilesMap[slot]).length} / 4`);
  set('debug-relay', relayText.split(/[·]/)[0].trim() || 'Unknown');
  const enabledSettings = Object.entries(automationSettings)
    .filter(([key, value]) => key.startsWith('auto') && value === true).length;
  set('debug-settings', `${enabledSettings} automation toggles on · ${automationSettings.scanGapMs} ms scan`);
  const available = document.getElementById('metric-available');
  if (available && typeof PAGE !== 'undefined') {
    const dates = availableCalendarDates(document).length;
    available.textContent = dates ? String(dates) : '—';
  }
}

function updateStage(stageName, progressWidth, desc = '') {
  currentStageDetail = desc;
  currentStageName = stageName;
  const stageTxt = document.getElementById('current-stage-txt');
  const progressBar = document.getElementById('progress-bar');
  const stageDesc = document.getElementById('stage-desc');
  if (stageTxt) stageTxt.innerText = stageName;
  if (progressBar) progressBar.style.width = progressWidth;
  if (stageDesc && desc) stageDesc.innerText = desc;
  const metric = document.getElementById('metric-stage');
  updateStepTrackerUI();
}

function startAutomation() {
  if (isRunning || resetInProgress) return;
  isRunning = true;
  isPaused = false;
  chrome.storage.local.set({ automatorRunning: true });
  refreshConfigDropdowns();
  logMessage('Adaptive automation started. Waiting for verified page transitions.');
  workflowObserver = new MutationObserver(records => {
    // Ignore panel-only changes so logging does not trigger an endless observer loop.
    const pageRecords = records.filter(record => !inPanel(record.target));
    if (!pageRecords.length) return;
    if (automationSettings.autoClosePopups && mutationAddsDialog(pageRecords)) executePopupCleanup();
    refreshConfigDropdowns();
    scheduleWorkflow(0);
  });
  workflowObserver.observe(document.body, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-busy', 'aria-checked', 'data-status']
  });
  updateStepTrackerUI();
  executeWorkflowSteps();
}

function stopAutomation(paused = false) {
  isRunning = false;
  isPaused = paused;
  otpRequestVersion++;
  if (otpSession) otpSession.fetchPending = false;
  clearTimeout(automatorInterval);
  automatorInterval = null;
  workflowObserver?.disconnect();
  workflowObserver = null;
  chrome.storage.local.set({ automatorRunning: false });
  updateStepTrackerUI();
  logMessage(paused ? 'Automation paused at the current step.' : 'Automation stopped.');
}

function pushManualOTP() {
  return runManualStep('otp');
}

function getOTPSession() {
  if (!otpSession) otpSession = {
    attempted: new Set(), submitted: false, manualPageInput: false,
    revision: 0, fetchPending: false, nextFetchAt: 0, fetchFailures: 0,
    awaitingManualSubmit: false, relayCode: null, relayMessageId: null,
    fetchPendingRequest: null, manualFillPending: false
  };
  return otpSession;
}
function clearOTPSession() {
  otpRequestVersion++;
  otpSession = null;
  const panelOTP = document.getElementById('otp-input-field');
  if (panelOTP) panelOTP.value = '';
}
function otpCode(value) { return String(value || '').replace(/\s/g, ''); }
function validOTP(code, field) {
  const length = field.maxLength > 0 && field.maxLength <= 10 ? field.maxLength :
    field.minLength > 0 && field.minLength <= 10 ? field.minLength : 6;
  return new RegExp(`^\\d{${length}}$`).test(code);
}
function pollOTPFromBackground(automatic = false, { force = false, fillOnly = false } = {}) {
  const generation = storageGeneration;
  const session = getOTPSession();
  const rejected = activeStep?.kind === 'otp' && !!first(PAGE.otpError, activeStep.root);
  if (resetInProgress || (automatic && !automationSettings.autoOtpFill) ||
    (session.awaitingManualSubmit && !fillOnly) || (session.fetchPending && !force) ||
    session.manualPageInput || (session.submitted && !rejected) ||
    (automatic && Date.now() < session.nextFetchAt)) return;
  const revision = session.revision;
  const requestVersion = ++otpRequestVersion;
  session.fetchPending = true;
  session.fetchPendingRequest = requestVersion;
  // 120 requests/minute stays below the relay's 180/minute browser limit.
  session.nextFetchAt = Date.now() + 500;
  const failed = () => {
    session.fetchFailures++;
    session.nextFetchAt = Date.now() + Math.min(10000, 1000 * 2 ** Math.min(session.fetchFailures, 3));
    if (!automatic) logMessage('OTP service unavailable. Waiting; manual OTP entry is still available.');
  };
  try {
    if (!chrome.runtime?.id) {
      session.fetchPending = false;
      session.fetchPendingRequest = null;
      failed();
      return;
    }
    chrome.runtime.sendMessage({ type: automatic ? 'WAIT_OTP' : 'FETCH_OTP' }, (response) => {
      if (session.fetchPendingRequest === requestVersion) {
        session.fetchPending = false;
        session.fetchPendingRequest = null;
      }
      if (generation !== storageGeneration || requestVersion !== otpRequestVersion ||
        session !== otpSession || session.revision !== revision || session.manualPageInput ||
        resetInProgress || (automatic && !isRunning) || (session.submitted && !rejected)) return;
      if (chrome.runtime.lastError || !response || !response.ok) {
        failed();
        return;
      }
      session.fetchFailures = 0;
        session.nextFetchAt = Date.now() + 500;
      if (automatic && isRunning) scheduleWorkflow(500);
      const data = response.data;
      if (fillOnly && !(data && data.success && data.otp)) {
        updateStage('OTP check', '30%', 'No new OTP is available from the relay yet. Try FILL OTP again shortly.');
        logMessage('Manual relay check found no new OTP.');
        return;
      }
      if (data && data.success && data.otp) {
        const code = otpCode(data.otp);
        if (!/^\d{4,10}$/.test(code) || session.attempted.has(code)) {
          if (fillOnly) {
            updateStage('OTP check', '30%', 'The relay code is invalid or was already used. Waiting for a new code.');
            logMessage('Manual relay fill ignored an invalid or previously submitted code.');
          }
          return;
        }
        const field = first(PAGE.otp);
        if (field && !validOTP(code, field)) return;
        if (fillOnly) {
          const panelField = document.getElementById('otp-input-field');
          if (!field) {
            updateStage('OTP check', '30%', 'The official OTP field is not visible yet. Try FILL OTP again when it appears.');
            logMessage('Manual relay fill is waiting for the official OTP field.');
            return;
          }
          if (field && field.value?.trim() && field.value !== code && !session.manualFillPending) {
            updateStage('OTP ready', '30%', 'A code is already present on the official page; it was left unchanged.');
            logMessage('Manual Fill OTP left the existing page code untouched.');
            return;
          }
          if (panelField) panelField.value = code;
          setValue(field, code);
          session.relayMessageId = data.messageId || null;
          session.relayCode = code;
          session.manualFillPending = true;
          session.awaitingManualSubmit = true;
          updateStage('OTP ready', '30%', 'Latest relay OTP filled on the official page. Verify it there; this button does not submit.');
          logMessage('Manual relay fill completed; OTP verification remains manual.');
          return;
        }
        const otpFieldBox = document.getElementById('otp-input-field');
        if (otpFieldBox) otpFieldBox.value = code;
        session.relayMessageId = data.messageId || null;
        session.relayCode = code;
        logMessage('Fetched OTP successfully.');
        pushManualOTP();
      }
    });
  } catch (err) {
    if (session.fetchPendingRequest === requestVersion) {
      session.fetchPending = false;
      session.fetchPendingRequest = null;
    }
    failed();
  }
}

const OTP_SUBMIT_LABEL = /^(verify(?: otp| code)?|submit|confirm(?: otp| code)?|verify\s*(?:&|and)\s*continue)$/i;
function submitOTPOnce(step, verify) {
  const session = getOTPSession();
  const code = otpCode(step.el.value);
  const rejected = !!first(PAGE.otpError, step.root);
  if (!automationSettings.autoSubmitOtp || session.manualPageInput || session.attempted.has(code) ||
    (session.submitted && !rejected) || !validOTP(code, step.el) ||
    !step.el.checkValidity() || !enabled(verify) || busy(step.root) || captchaPending(step.root)) return false;
  // Record BEFORE clicking: synchronous rerenders or event handlers cannot resend.
  session.attempted.add(code);
  session.submitted = true;
  step.submitted = true;
  step.tries++;
  // A synthetic click may cause the browser to emit a trusted submit event.
  // Keep that default form action from being mistaken for a user override.
  session.autoSubmitting = true;
  try {
    verify.click();
  } finally {
    session.autoSubmitting = false;
  }
  acknowledgeRelayOTP(session, code);
  updateStage('OTP verification', '30%', 'OTP submitted once. Waiting for verification; no automatic resubmission.');
  logMessage('OTP submitted once; waiting for the verified page transition.');
  return true;
}
function acknowledgeRelayOTP(session, code) {
  if (!session?.relayMessageId || session.relayCode !== code) return;
  const messageId = session.relayMessageId;
  session.relayMessageId = null;
  chrome.runtime.sendMessage({ type: 'PHONE_ACK_OTP', messageId }, () => {
    if (chrome.runtime.lastError) logMessage('OTP receipt could not be saved; this code will not be resubmitted in this session.');
  });
}
function performOTP(step) {
  const session = getOTPSession();
  const rejected = !!first(PAGE.otpError, step.root);
  if (session.manualPageInput) {
    updateStage('OTP verification', '30%', 'Manual OTP entry detected. Verify on the website; automation will resume after acceptance.');
    return;
  }
  if (session.submitted && !rejected) {
    updateStage('OTP verification', '30%', 'OTP submitted once. Waiting for verification; no automatic resubmission.');
    return;
  }
  if (session.manualFillPending) {
    updateStage('OTP ready', '30%', 'Latest relay OTP is filled. Verify it on the official page to continue.');
    return;
  }
  const code = otpCode(document.getElementById('otp-input-field')?.value);
  if (validOTP(code, step.el) && !session.attempted.has(code)) {
    setValue(step.el, code);
    if (!automationSettings.autoSubmitOtp) {
      session.awaitingManualSubmit = true;
      updateStage('OTP ready', '30%', 'OTP filled once. Submit it on the official page to continue.');
      return;
    }
    submitOTPOnce(step, button(OTP_SUBMIT_LABEL, step.root));
    return;
  }
  // Never overwrite or automatically submit a code already entered on the site.
  if (step.el.value?.trim() && !session.submitted) {
    session.manualPageInput = true;
    updateStage('OTP verification', '30%', 'Code present on the website. Please verify it manually.');
    return;
  }
  updateStage('OTP verification', '30%', rejected ?
    'Code rejected or expired. Waiting for a NEW code; the previous code will not be retried.' :
    'Waiting for a paired-phone OTP or manual entry…');
  if (isRunning && (!code || session.attempted.has(code))) pollOTPFromBackground(true);
}
function observeManualOTP(event) {
  if (!event.isTrusted || inPanel(event.target)) return;
  const field = event.type === 'input' && event.target.matches?.(PAGE.otp) ?
    event.target : first(PAGE.otp);
  if (!field || !visible(field)) return;
  const session = getOTPSession();
  if (session.autoSubmitting) return;
  if (event.type === 'input') {
    session.manualPageInput = true;
    session.manualFillPending = false;
    session.revision++;
    scheduleWorkflow(0);
    return;
  }
  const root = scopeOf(field);
  const control = event.target.closest?.('button, input[type="submit"], input[type="button"], [role="button"]');
  const submitting = event.type === 'submit' ? event.target.contains(field) :
    control && root.contains(control) && OTP_SUBMIT_LABEL.test(label(control));
  if (!submitting) return;
  const code = otpCode(field.value);
  if (code) session.attempted.add(code);
  session.awaitingManualSubmit = false;
  session.manualFillPending = false;
  acknowledgeRelayOTP(session, code);
  session.manualPageInput = true;
  session.submitted = true;
  session.revision++;
  if (activeStep?.kind === 'otp') activeStep.submitted = true;
  scheduleWorkflow(0);
}

function observeManualWorkflowAction(event) {
  const step = popupContinuation || activeStep;
  if (!event.isTrusted || inPanel(event.target) || !step || step.kind === 'otp') return;
  const control = event.type === 'submit' ?
    (event.submitter || event.target.querySelector?.('button[type="submit"], input[type="submit"]')) :
    event.target.closest?.('button, a[href], input[type="submit"], input[type="button"], [role="button"]');
  if (!control || !step.root.contains(control)) return;
  const patterns = {
    login: /^sign in(?: now)?$|^log in$|^login$/i,
    signIn: /^sign in(?: now)?$|^log in$|^login$|^continue$|^next$/i,
    appointment: /^take your appointment\b/i,
    next: NEXT_LABEL,
    details: DETAILS_LABEL,
    upload: /^(confirm all information is correct|continue|next|proceed)$/i,
    mission: CENTER_CONFIRM_LABEL,
    booking: /^continue booking$/i
  };
  if (!patterns[step.kind]?.test(label(control))) return;
  if (step.kind === 'upload') {
    const inputs = fileInputs(step.root);
    const hasUploadedFile = inputs.some(input => uploadSucceeded(input));
    const pendingRequired = inputs.some(input => input.required && !uploadSucceeded(input));
    const pendingSelected = inputs.some(input => input.files?.length && !uploadSucceeded(input));
    if (!hasUploadedFile || pendingRequired || pendingSelected) return;
    step.uploadContinueSent = true;
    step.uploadRecords ||= [];
  }
  if (step.kind === 'mission') stepStatus.centerSelected = true;
  if (step.kind === 'booking') {
    if (!step.calendar) return;
    step.calendar.continueSent = true;
    step.calendar.nextAttemptAt = Date.now() + SLOT_RETRY_MS;
    persistCalendarRetry(step.calendar);
  }
  step.submitted = true;
  step.manualSubmitted = true;
  step.nextTry = Date.now() + 1200;
  logMessage(`${step.kind}: manual page action detected; waiting for a verified transition.`);
  scheduleWorkflow(0);
}

// Manual pushes use exactly the same locks, CAPTCHA gates and retry rules.
function executeSignInStep() { return runManualStep('signIn'); }
function executeTakeAppointmentStep() { return runManualStep('appointment'); }
function executeFileUploadLogic() { return runManualStep('upload'); }
function executeMissionSelection() { return runManualStep('mission'); }
function executeSlotBooking() { return runManualStep('booking'); }

// Selectors are deliberately conservative. Add actual site-specific success/error
// selectors here rather than guessing success from a click or an arbitrary tick.
const PAGE = {
  dialogs: 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal, .popup, .popup-overlay, .dialog, .swal2-popup, .swal-modal, .ant-modal, .MuiDialog-root, [data-state="open"][data-dialog], .fixed.inset-0',
  otp: 'input[name*="otp" i], input[placeholder*="otp" i], input[aria-label*="otp" i], input#otp, input[autocomplete="one-time-code"]',
  otpOK: '[data-otp-status="verified"], [data-otp-status="success"], #otp-success, .otp-success',
  otpError: '[data-otp-status="error"], [data-otp-status="expired"], .otp-error, #otp-error',
  phone: 'input[type="tel"], input[placeholder*="01"], input[name="username"]',
  mission: 'select[name*="mission" i], select#mission, select.mission-select',
  center: 'select[name*="center" i], select#center, select.center-select',
  missionOK: '[data-mission-status="confirmed"], [data-center-status="confirmed"], #mission-success, .mission-success',
  dates: '.calendar-day.available:not(.disabled), td.available:not(.disabled), .calendar .day.available, .p-datepicker-calendar td:not(.p-disabled) span:not(.p-disabled)',
  busy: '[aria-busy="true"], [role="progressbar"], .loading-spinner, .spinner-border, .ant-spin-spinning, [data-status="uploading"]',
  uploadOK: '[data-upload-status="success"], [data-status="uploaded"], .upload-success, .ant-upload-list-item-done',
  uploadError: '[data-upload-status="error"], [data-status="error"], .upload-error, .ant-upload-list-item-error',
  booked: '[data-booking-status="confirmed"], #booking-success, .booking-success',
  payment: '[data-stage="payment"], [data-step="payment"], [data-stage="confirmation"], [data-payment-stage], #payment-page, #payment-form, .payment-page, #booking-confirmation, .booking-confirmation',
  captcha: '.g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"]',
  captchaToken: '[name="g-recaptcha-response"], [name="h-captcha-response"], [name="cf-turnstile-response"]'
};
const STATUS_KEY = {
  signIn: 'signIn', otp: 'otpVerified', appointment: 'takeAppointmentClicked',
  upload: 'filesUploaded', mission: 'missionSelected', booking: 'slotBooked',
  details: 'detailsConfirmed'
};
let workflowObserver = null;
let activeStep = null;
let attemptCount = 0;
let executing = false;
let scheduledAt = 0;
let popupContinuation = null;
const clickHistory = new WeakMap();

function inPanel(el) {
  return !!el?.closest?.('#visa-automator-floating-panel');
}
function visible(el) {
  if (!el?.isConnected || inPanel(el) || el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' && el.getClientRects().length > 0;
}
function all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector)).filter(visible);
}
function first(selector, root = document) { return all(selector, root)[0] || null; }
function enabled(el) {
  return visible(el) && !el.disabled && !el.matches(':disabled, [aria-disabled="true"], .disabled, .p-disabled');
}
function label(el) {
  return (el.getAttribute('aria-label') || el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
}
function button(pattern, root = document) {
  return all('button, a[href], input[type="submit"], input[type="button"], [role="button"]', root)
    .find(el => pattern.test(label(el))) || null;
}
function scopeOf(el) {
  return el?.closest(`form, ${PAGE.dialogs}, [data-step], .card`) ||
    document.body;
}
function busy(root = document) { return !!first(PAGE.busy, root); }
function setValue(el, value) {
  if (!el || el.value === value) return false;
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
function click(el, delay = 3000) {
  if (!enabled(el) || Date.now() - (clickHistory.get(el) || 0) < delay) return false;
  clickHistory.set(el, Date.now());
  el.click();
  return true;
}
function pageRateLimited(root = document) {
  if (first('[data-http-status="429"], [data-status="429"], [data-error-code="429"]', root)) return true;
  return /(?:\b429\b|too many requests|rate limit(?:ed)?)/i.test((root?.innerText || '').slice(0, 12000));
}
function scheduleWorkflow(delay = 700) {
  if (!isRunning) return;
  if (delay === 700) delay = automationSettings.scanGapMs;
  const due = Date.now() + delay;
  if (automatorInterval && scheduledAt <= due) return;
  clearTimeout(automatorInterval);
  scheduledAt = due;
  automatorInterval = setTimeout(() => {
    automatorInterval = null;
    if (isRunning) executeWorkflowSteps();
  }, delay);
}

const NEXT_LABEL = /^next(?: step)?$/i;
const DETAILS_LABEL = /^save\s*(?:and|&)\s*continue$/i;
const CENTER_CONFIRM_LABEL = /^confirm mission\s*(?:&|and)\s*ivac center$/i;
const REQUIRED_NOTICE_TEXT = /\bimportant\s+notice\b|\badvisory\b/i;
function isRequiredNoticeDialog(dialog) {
  return REQUIRED_NOTICE_TEXT.test(String(dialog?.innerText || dialog?.textContent || '').replace(/\s+/g, ' '));
}
function requiredNoticeDialog() {
  return all(PAGE.dialogs).find(isRequiredNoticeDialog) || null;
}
function workflowDialog(root) {
  return !!button(NEXT_LABEL, root) || !!button(DETAILS_LABEL, root) ||
    !!button(/^confirm all information is correct$/i, root) ||
    !!button(CENTER_CONFIRM_LABEL, root) || !!button(/^continue booking$/i, root);
}
function mutationAddsDialog(records) {
  return records.some(record => Array.from(record.addedNodes || []).some(node =>
    node.nodeType === 1 && (node.matches?.(PAGE.dialogs) || node.querySelector?.(PAGE.dialogs))));
}
function hasWorkflowControls(root) {
  return !!first(`${PAGE.otp}, ${PAGE.phone}, input[type="password"], ${PAGE.mission}, ${PAGE.center}`, root) ||
    fileInputs(root).length > 0 || !!first(PAGE.captcha, root);
}
function executePopupCleanup() {
  if (!automationSettings.autoClosePopups) return false;
  let closed = false;
  const dialogs = all(PAGE.dialogs).reverse();
  for (const dialog of dialogs) {
    // Never destroy a live OTP, CAPTCHA, document or other data-entry form.
    if (isRequiredNoticeDialog(dialog) || workflowDialog(dialog) || hasWorkflowControls(dialog) ||
        first('input:not([type="hidden"]), select, textarea', dialog)) continue;
    const dismiss = all('button, a, [role="button"]', dialog).find(el =>
      /^(close|cancel|dismiss|not now|no thanks|×|✕|x)$/i.test(label(el)) ||
      el.matches('.modal-close, .swal2-close, [data-dismiss="modal"], [data-bs-dismiss="modal"]'));
    if (dismiss && click(dismiss, 1200)) closed = true;
  }
  // Standalone close controls, but never unrelated position:absolute buttons.
  for (const el of all('.modal-close, button[aria-label="Close"], button[aria-label="Dismiss"], [data-bs-dismiss="modal"], [data-dismiss="modal"]')) {
    const host = el.closest(PAGE.dialogs);
    if (host && !isRequiredNoticeDialog(host) && !workflowDialog(host) && !hasWorkflowControls(host) &&
        !first('input:not([type="hidden"]), select, textarea', host)) {
      if (click(el, 1200)) closed = true;
    }
  }
  stepStatus.popupsCleaned = all(PAGE.dialogs).length === 0;
  if (closed) {
    cleanupPending = true;
    revealTrackerStep('popups');
    logMessage('Dismissed a non-workflow popup.');
  } else if (stepStatus.popupsCleaned) cleanupPending = false;
  updateStepTrackerUI();
  return closed;
}

function fileInputs(root = document) {
  // Real upload inputs are often hidden behind labels. Exclude panel inputs,
  // disabled fields and inputs in hidden/inactive forms, not just hidden inputs.
  return Array.from(root.querySelectorAll('input[type="file"]')).filter(el =>
    !inPanel(el) && !el.closest('[inert], [aria-hidden="true"]') &&
    (visible(el) || visible(el.parentElement)));
}
function captchaPending(root = document) {
  const widgets = all(PAGE.captcha, root);
  if (!widgets.length) return false;
  const tokens = Array.from(root.querySelectorAll(PAGE.captchaToken)).filter(el => !inPanel(el));
  // Cross-origin CAPTCHA frames are not inspected or clicked. Their host-provided
  // response is the authoritative completion signal.
  return !tokens.some(el => el.value?.trim());
}
function detectSteps() {
  const steps = [];
  const add = (kind, el) => { if (el) steps.push({ kind, el, root: scopeOf(el) }); };
  const otpField = first(PAGE.otp);
  if (otpField && !first(PAGE.otpOK, scopeOf(otpField))) add('otp', otpField);
  add('signIn', first('input[type="password"]') || all(PAGE.phone).find(el => !el.matches(PAGE.otp)));
  const uploads = fileInputs();
  add('upload', uploads[0] || button(/^confirm all information is correct/i));
  const missionControl = first(PAGE.mission) || first(PAGE.center) || customCenter() || button(CENTER_CONFIRM_LABEL);
  if (missionControl && !first(PAGE.missionOK, scopeOf(missionControl))) add('mission', missionControl);
  add('appointment', button(/^take your appointment\b/i));
  add('booking', first(PAGE.dates) || button(/^continue booking$/i));
  add('details', button(DETAILS_LABEL));
  if (!steps.length) add('next', button(NEXT_LABEL));
  if (!steps.length) add('login', button(/^sign in(?: now)?$|^log in$|^login$/i));
  for (const dialog of all(PAGE.dialogs).reverse()) {
    if (!hasWorkflowControls(dialog)) {
      const next = button(NEXT_LABEL, dialog);
      if (next) { steps.unshift({ kind: 'next', el: next, root: dialog, interruption: true }); break; }
    }
  }
  // A visible modal is the active page context, not the controls underneath it.
  const topDialog = all(PAGE.dialogs).at(-1);
  if (topDialog) return steps.filter(step => topDialog.contains(step.el));
  return steps;
}
function status(kind, done) {
  if (STATUS_KEY[kind]) stepStatus[STATUS_KEY[kind]] = done;
  if (kind === 'otp' && done) clearOTPSession();
  if (kind === 'next') {
    trackerNextComplete = done;
    stepStatus.noticeConfirmed = done;
  }
  revealTrackerStep(kind);
  updateStepTrackerUI();
}
function newStep(candidate) {
  status(candidate.kind, false);
  return { ...candidate, tries: 0, nextTry: 0,
    submitted: candidate.kind === 'otp' && !!otpSession?.submitted, absentSince: 0, selectedDate: false };
}
function submitStep(step, el) {
  if (step.kind === 'otp') return submitOTPOnce(step, el);
  if (['login', 'signIn', 'appointment', 'next', 'details', 'mission', 'booking'].includes(step.kind) &&
      !automationSettings.autoNavigate) {
    updateStage('Manual navigation', '45%', 'Auto navigate is off. Use the official page control; detection will resume afterward.');
    return false;
  }
  if (Date.now() < step.nextTry || !el || busy(step.root) || captchaPending(step.root)) return false;
  if (pageRateLimited(step.root)) {
    step.nextTry = Date.now() + automationSettings.rate429BackoffMs;
    updateStage('Rate limit backoff', '50%', `The page reports a rate limit. Waiting ${Math.ceil(automationSettings.rate429BackoffMs / 1000)} seconds before retrying.`);
    return false;
  }
  if (!click(el)) return false;
  step.tries++;
  step.submitted = true;
  // Persistent retries, capped at a 20-second interval, never rapid-fire requests.
  step.nextTry = Date.now() + (pageRateLimited(step.root) ? automationSettings.rate429BackoffMs :
    Math.min(20000, 3000 * 2 ** Math.min(step.tries - 1, 3)));
  logMessage(`${step.kind}: action sent; waiting for confirmation (attempt ${step.tries}).`);
  return true;
}
function performStep(step) {
  if (captchaPending(step.root)) {
    updateStage('CAPTCHA', '20%', 'Complete the CAPTCHA manually. Waiting for its verified response.');
    return;
  }
  if (busy(step.root)) {
    updateStage('Waiting', '50%', 'The current step is loading; no other action will run.');
    return;
  }
  if (Date.now() < step.nextTry) return;
  const root = step.root;
  switch (step.kind) {
    case 'login':
      if (!automationSettings.autoSignIn) {
        updateStage('Sign in', '5%', 'Auto sign-in is off. Open the sign-in page manually.');
        return;
      }
      updateStage('Open sign-in', '5%', 'Opening the sign-in form before filling credentials.');
      submitStep(step, step.el);
      break;
    case 'signIn': {
      if (!automationSettings.autoSignIn) {
        updateStage('Sign in', '15%', 'Auto sign-in is off. Sign in on the official page; detection will resume.');
        return;
      }
      updateStage('Sign in', '15%', 'Waiting for sign-in acceptance.');
      const phone = first(PAGE.phone, root) || first(PAGE.phone);
      const pass = first('input[type="password"]', root);
      const phoneValue = document.getElementById('phone-field')?.value?.trim();
      const passValue = document.getElementById('pass-field')?.value;
      let changed = false;
      if (phone && phoneValue) changed = setValue(phone, phoneValue) || changed;
      if (pass && passValue) changed = setValue(pass, passValue) || changed;
      if ((phone && !phone.value) || (pass && !pass.value)) return;
      if (changed) { step.nextTry = Date.now() + 400; return; }
      submitStep(step, button(/^sign in(?: now)?$|^log in$|^login$|^continue$|^next$/i, root));
      break;
    }
    case 'otp': {
      performOTP(step);
      break;
    }
    case 'appointment':
      updateStage('Take appointment', '45%', 'Waiting for the appointment page.');
      submitStep(step, step.el);
      break;
    case 'next':
      updateStage('Next', '55%', 'Opening the next page before document upload.');
      submitStep(step, step.el);
      break;
    case 'details':
      updateStage('Confirm details', '82%', 'Saving the confirmed applicant details before center selection.');
      submitStep(step, step.el);
      break;
    case 'upload':
      performUploads(step);
      break;
    case 'mission': {
      performMissionSelection(step);
      break;
    }
    case 'booking': {
      performCalendarSearch(step);
      break;
    }
  }
}
function uploadScope(input) {
  return input.closest('[data-upload-item], .upload-item, .ant-upload-wrapper, .form-group, .mb-3') || input.parentElement;
}
function uploadSucceeded(input) {
  const root = uploadScope(input);
  // Never accept another document's tick from a shared form or page container.
  if (!root || root === document.body || root.querySelectorAll('input[type="file"]').length > 1) {
    return input.dataset.uploadStatus === 'success';
  }
  return input.dataset.uploadStatus === 'success' || !!first(PAGE.uploadOK, root) ||
    all('[aria-label], [title], [role="status"]', root).some(el =>
      /^(upload(?:ed)? (?:complete|successful)|file uploaded successfully|verified)$/i.test(
        el.getAttribute('aria-label') || el.getAttribute('title') || label(el))) ||
    // A bare check mark is accepted only in an upload's own status element.
    all('.upload-status, [data-upload-status], [role="status"]', root).some(el => /^[✓✔]$/.test(label(el)));
}
function uploadRowSucceeded(row) {
  const directStatus = `${row.getAttribute?.('data-upload-status') || ''} ${row.getAttribute?.('data-status') || ''}`.trim();
  if (/^(success|uploaded|complete|verified)$/i.test(directStatus)) return true;
  if (row.matches?.(PAGE.uploadOK) || first(PAGE.uploadOK, row)) return true;
  return all('[data-upload-status], [data-status], .upload-status, [role="status"]', row).some(el => {
    const status = `${el.getAttribute('data-upload-status') || ''} ${el.getAttribute('data-status') || ''} ${label(el)}`.trim();
    return /^(success|uploaded|upload(?:ed)? complete|upload(?:ed)? successfully|file uploaded successfully|verified|✓|✔)$/i.test(status);
  });
}
function pageConfirmsFile(file, inputs = fileInputs(document), record = null) {
  const expectedName = String(file?.name || '').trim().toLowerCase();
  if (!expectedName) return false;
  const selectedAndConfirmed = inputs.some(input =>
    Array.from(input.files || []).some(selected =>
      selected.name === file.name && selected.size === file.size) &&
    uploadSucceeded(input) &&
    // On a reused single input, an old green status must not confirm the
    // newly assigned file until a new pending/success transition is observed.
    (!record?.attached || record.sawPending || !record.wasAlreadySuccessful ||
      uploadReceipt(input) !== record.receiptBeforeAttach));
  if (selectedAndConfirmed) return true;
  const rows = all('[data-upload-item], .upload-item, .ant-upload-list-item, .upload-row, [role="listitem"]');
  return rows.some(row => {
    if (inPanel(row)) return false;
    const text = [
      row.getAttribute('data-file-name') || '',
      row.getAttribute('title') || '',
      row.getAttribute('aria-label') || '',
      row.textContent || ''
    ].join(' ').toLowerCase();
    return text.includes(expectedName) && uploadRowSucceeded(row);
  });
}
function orderedUploadFiles() {
  return [primarySlotKey, ...FILE_SLOTS.filter(k => k != primarySlotKey)]
    .map(k => uploadedFilesMap[k]).filter(Boolean);
}
function uploadInputForRecord(step, record, recordIndex, inputs) {
  if (record.input && inputs.includes(record.input)) return record.input;
  const assigned = new Set(step.uploadRecords
    .filter(other => other !== record && other.input && inputs.includes(other.input))
    .map(other => other.input));
  // Applicant controls can be added after the primary upload succeeds. Prefer
  // a newly available field; when the page exposes one reusable field, cycle
  // back to it only after all earlier files have been acknowledged.
  const next = inputs.find(input => !assigned.has(input)) ||
    (inputs.length === 1 ? inputs[0] : inputs[recordIndex % inputs.length]);
  record.input = next || null;
  return record.input;
}
function uploadReceipt(input) {
  return JSON.stringify([input.dataset.uploadStatus || '', all(PAGE.uploadOK, uploadScope(input))
    .map(el => el.outerHTML || label(el))]);
}
function performUploads(step) {
  if (!automationSettings.autoUploadPdf) {
    updateStage('Upload documents', '70%', 'Auto upload is off. Upload the configured PDFs manually and wait for each confirmation.');
    return;
  }
  updateStage('Upload documents', '70%', 'Waiting for the primary document before secondary uploads.');
  // Re-scan the page on every attempt: some applicant forms render later upload
  // controls only after the preceding file has been accepted.
  const inputs = fileInputs(document);
  if (primarySlotKey && !uploadedFilesMap[primarySlotKey]) {
    updateStage('Upload documents', '70%', 'Load the selected primary document before uploading secondary files.');
    return;
  }
  if (!step.uploadRecords) {
    const files = orderedUploadFiles();
    if (!files.length) {
      updateStage('Upload documents', '70%', 'Load at least one document in the panel.');
      return;
    }
    // Freeze the chosen order for this upload screen, including slot four.
    step.uploadRecords = files.map(file => ({ file, done: false, attached: false, sentAt: 0 }));
  }
  for (let i = 0; i < step.uploadRecords.length; i++) {
    const record = step.uploadRecords[i];
    if (record.done) continue;
    if (pageConfirmsFile(record.file, inputs, record)) {
      record.done = true;
      record.input = inputs[i] || null;
      logMessage(`Document ${i + 1} is already confirmed on the page; skipping re-upload.`);
      continue;
    }
    const input = uploadInputForRecord(step, record, i, inputs);
    if (!input || input.disabled || input.matches?.(':disabled, [aria-disabled="true"]')) {
      updateStage('Upload documents', '70%', `Waiting for document ${i + 1}'s upload field to become ready.`);
      return;
    }
    const local = uploadScope(input);
    if (busy(local) || captchaPending(local)) return;
    const succeeded = uploadSucceeded(input);
    const selected = input.files[0];
    const matchesFile = selected && selected.name === record.file.name && selected.size === record.file.size;
    // Existing selections are accepted only if the expected file is bound to a
    // distinct input. A shared input's old green tick cannot confirm a new file.
    if (!record.attached && matchesFile && succeeded && (i === 0 || inputs.length > 1)) {
      record.done = true;
      continue;
    }
    if (record.attached) {
      if (!succeeded) record.sawPending = true;
      if (succeeded && matchesFile && (record.sawPending || !record.wasAlreadySuccessful ||
        uploadReceipt(input) !== record.receiptBeforeAttach)) {
        record.done = true;
        logMessage(`Document ${i + 1} upload acknowledged.`);
        continue;
      }
    }
    const failed = !!first(PAGE.uploadError, local);
    if (!record.attached || (failed && Date.now() - record.sentAt >= 5000)) {
      record.wasAlreadySuccessful = succeeded;
      record.receiptBeforeAttach = uploadReceipt(input);
      const transfer = new DataTransfer();
      transfer.items.add(record.file);
      input.files = transfer.files;
      record.attached = true;
      record.sentAt = Date.now();
      record.sawPending = !succeeded;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (!uploadSucceeded(input) || busy(local)) record.sawPending = true;
      step.nextTry = Date.now() + 700;
      logMessage(`${i === 0 ? 'Primary' : 'Secondary'} document attached; waiting for server confirmation.`);
      return;
    }
    updateStage('Upload documents', '70%', `Waiting for document ${i + 1}/${step.uploadRecords.length} to be verified.`);
    // Upload is not Continue: this starts server processing but never advances.
    submitStep(step, button(/^upload(?: file| document| all files| documents)?$/i, local) ||
      button(/^upload(?: file| document| all files| documents)?$/i, step.root));
    return;
  }
  if (busy(step.root) || captchaPending(step.root)) return;
  // Optional empty website slots do not require extra documents; required slots do.
  if (inputs.some(input => input.required && !uploadSucceeded(input))) {
    updateStage('Upload documents', '75%', 'A required website upload still needs confirmation.');
    return;
  }
  updateStage('Upload documents', '80%', 'All loaded documents are acknowledged. Continuing…');
  const confirm = all('button, a[href], input[type="submit"], [role="button"]', step.root).find(el =>
    enabled(el) && /^(confirm all information is correct|continue|continue to (?!payment\b|checkout\b).+|next|proceed)$/i.test(label(el)));
  if (confirm && !automationSettings.autoNavigate) {
    updateStage('Upload documents', '80%', 'All PDFs are confirmed. Auto navigate is off; review and click the site confirmation manually.');
    return;
  }
  if (confirm && submitStep(step, confirm)) step.uploadContinueSent = true;
  // Completion remains locked until a stable, recognized next page appears.
}
function usableOption(option) {
  return !!option && !option.disabled && !option.parentElement?.disabled &&
    !!String(option.value).trim() && !/^(select|choose|loading|no .+available|--)/i.test(option.textContent.trim());
}
function customCenter(root = document) {
  return all('[role="combobox"], button, [role="button"]', root).find(el =>
    /ivac\s*cent(?:er|re)/i.test(
      `${el.getAttribute('aria-label') || ''} ${el.getAttribute('name') || ''} ${label(el)}`
    ) && !CENTER_CONFIRM_LABEL.test(label(el))) || null;
}
function performMissionSelection(step) {
  updateStage('Mission / center', '90%', 'Keeping the selected mission and choosing an available IVAC center.');
  if (first(PAGE.missionOK, step.root)) {
    status('mission', true);
    stepStatus.centerSelected = true;
    activeStep = null;
    return;
  }
  if (!automationSettings.autoMissionCenter) {
    updateStage('Mission / center', '90%', 'Auto mission/center is off. Choose the center manually; the detector will resume.');
    return;
  }
  const mission = first(PAGE.mission, step.root);
  if (mission && !usableOption(mission.options[mission.selectedIndex])) {
    updateStage('Mission / center', '85%', 'Waiting for the page to select its mission.');
    return;
  }
  const wantedMission = document.getElementById('config-mission')?.value;
  if (mission && wantedMission && mission.value !== wantedMission) {
    const missionOption = Array.from(mission.options).find(option =>
      usableOption(option) && (option.value === wantedMission || option.textContent.trim() === wantedMission));
    if (!missionOption) {
      updateStage('Mission / center', '85%', 'Configured mission is not available on this page; no substitute will be selected.');
      return;
    }
    setValue(mission, missionOption.value);
    step.nextTry = Date.now() + 250;
    return;
  }
  const center = first(PAGE.center, step.root);
  if (!center) {
    const control = customCenter(step.root) ||
      (step.centerControl?.isConnected && visible(step.centerControl) ? step.centerControl : null);
    if (!control || !enabled(control)) return;
    step.centerControl = control;
    const wanted = document.getElementById('config-center')?.value;
    const listId = control.getAttribute('aria-controls');
    const list = listId ? document.getElementById(listId) : first('[role="listbox"]');
    const options = list ? all('[role="option"]', list).filter(el => enabled(el) &&
      !/^(select|choose|loading|no .+available)/i.test(label(el))) : [];
    if (options.length) {
      const option = wanted ?
        options.find(el => label(el) === wanted || el.getAttribute('data-value') === wanted) : options[0];
      if (!option) {
        updateStage('Mission / center', '85%', 'Waiting for the configured IVAC center; no substitute center will be submitted.');
        return;
      }
      if (click(option)) {
        step.centerChoice = label(option);
        step.nextTry = Date.now() + 100;
      }
      return;
    }
    // Require the selected center to appear on the control before confirmation.
    const selected = step.centerChoice && label(control).includes(step.centerChoice);
    if (selected || (!/select\s+(?:your\s+)?ivac\s*cent(?:er|re)/i.test(label(control)) &&
          control.getAttribute('data-state') === 'closed' && control.getAttribute('data-value'))) {
      stepStatus.centerSelected = true;
      updateStepTrackerUI();
      submitStep(step, button(CENTER_CONFIRM_LABEL, step.root));
    } else click(control, 1500);
    return;
  }
  if (center.disabled || center.matches?.(':disabled, [aria-disabled="true"]')) return;
  const available = Array.from(center.options).filter(usableOption);
  if (!available.length) {
    updateStage('Mission / center', '85%', 'Waiting for an available IVAC center to load.');
    return;
  }
  const wanted = document.getElementById('config-center')?.value;
  const required = wanted ? available.find(o => o.value === wanted || o.textContent.trim() === wanted) : null;
  if (wanted && !required) {
    updateStage('Mission / center', '85%', 'Waiting for the configured IVAC center; no substitute center will be submitted.');
    return;
  }
  if (!usableOption(center.options[center.selectedIndex]) || (required && center.value !== required.value)) {
    const option = required || available[0];
    setValue(center, option.value);
    step.submitted = true; // onchange may itself navigate to the next screen.
    step.nextTry = Date.now() + 100;
    return;
  }
  stepStatus.centerSelected = true;
  updateStepTrackerUI();
  submitStep(step, button(/^save\s*(?:and|&)\s*continue$|^confirm mission(?:\s*(?:&|and)\s*ivac center)?$|^continue$|^next$|^proceed$/i, step.root));
}
const SLOT_RETRY_MS = 20000;
function paymentStageReached() {
  if (first(PAGE.payment) || first(PAGE.booked)) return true;
  const route = window.location.pathname || '';
  if (/\/(?:payment|checkout|confirmation|confirm-booking)(?:\/|$)/i.test(route)) return true;
  return all('main h1, main h2, [role="main"] h1, [role="main"] h2').some(el =>
    /^(payment(?: details| summary)?|booking confirmation|payment confirmation|confirm (?:your )?(?:appointment|booking))$/i.test(label(el)));
}
function finishAtPayment() {
  // Reaching payment is not proof of a paid or confirmed appointment.
  stepStatus.paymentReached = true;
  stepStatus.dateContinued = true;
  if (first(PAGE.booked)) status('booking', true);
  activeStep = null;
  popupContinuation = null;
  cleanupPending = false;
  calendarResume = null;
  chrome.storage.local.set({ calendarRetry: null });
  stopAutomation();
  updateStage('Payment / confirmation', '100%', 'Payment/confirmation reached. Automation stopped; review and continue manually.');
  const next = document.getElementById('metric-next');
  if (next) next.innerText = '—';
  const trying = document.getElementById('metric-trying');
  if (trying) trying.textContent = '—';
  logMessage('Reached payment/confirmation. No payment or final-confirm button was clicked.');
}
function middleOut(items) {
  const order = [];
  const middle = Math.floor((items.length - 1) / 2);
  for (let offset = 0; order.length < items.length; offset++) {
    if (middle + offset < items.length) order.push(items[middle + offset]);
    if (offset > 0 && middle - offset >= 0) order.push(items[middle - offset]);
  }
  return order;
}
function calendarDateKey(el) {
  return el.getAttribute('data-date') || el.closest('[data-date]')?.getAttribute('data-date') || el.getAttribute('datetime') ||
    el.getAttribute('aria-label') || el.getAttribute('title') ||
    `${first('.calendar-title, .p-datepicker-title')?.textContent?.trim() || ''}:${label(el)}`;
}
function calendarHeading(root = document) {
  return all('.calendar-title, .p-datepicker-title, [data-calendar-title], h2, h3', root)
    .map(label).find(text => /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b/i.test(text)) || '';
}
function parseCalendarDate(el) {
  const raw = [
    el.getAttribute('data-date'), el.closest('[data-date]')?.getAttribute('data-date'),
    el.getAttribute('datetime'), el.getAttribute('aria-label'), el.getAttribute('title'), label(el)
  ].filter(Boolean).join(' ');
  const iso = raw.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = raw.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const monthAndYear = calendarHeading(el.closest('[role="dialog"], .calendar, [data-calendar]') || document);
  const day = raw.match(/(?:^|\D)([1-9]|[12]\d|3[01])(?:\D|$)/)?.[1];
  if (day && monthAndYear) {
    const parsed = new Date(`${monthAndYear.replace(/\s+/g, ' ')} ${day}`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (!/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{4})\b/i.test(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}
function withinConfiguredMonthRange(el) {
  const date = parseCalendarDate(el);
  if (!date) return true;
  const now = new Date();
  const monthDistance = (date.getFullYear() - now.getFullYear()) * 12 + date.getMonth() - now.getMonth();
  return monthDistance >= 0 && monthDistance < automationSettings.monthRange;
}
function monthKey(root = document, dates = []) {
  const heading = calendarHeading(root);
  const parsed = heading && Date.parse(`1 ${heading}`);
  if (parsed && !Number.isNaN(parsed)) {
    const date = new Date(parsed);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  const date = dates.length ? parseCalendarDate(dates[0]) : null;
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : '';
}
function sortCalendarDates(dates) {
  const indexed = dates.map((el, index) => ({ el, index, date: parseCalendarDate(el) }));
  indexed.sort((a, b) => a.date && b.date ? a.date - b.date : a.index - b.index);
  const ordered = indexed.map(item => item.el);
  const preferred = automationSettings.preferredDate ? ordered.findIndex(el => {
    const date = parseCalendarDate(el);
    return date && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === automationSettings.preferredDate;
  }) : -1;
  if (preferred >= 0) ordered.unshift(...ordered.splice(preferred, 1));
  if (automationSettings.slotRotation === 'middle') {
    const preferredElement = preferred >= 0 ? ordered.shift() : null;
    const middle = middleOut(ordered);
    return preferredElement ? [preferredElement, ...middle] : middle;
  }
  if (automationSettings.slotRotation === 'backward') {
    const preferredElement = preferred >= 0 ? ordered.shift() : null;
    ordered.reverse();
    if (preferredElement) ordered.unshift(preferredElement);
  }
  return ordered;
}
function advanceCalendarMonth(step, state, currentMonth) {
  if (state.visitedMonths.size >= automationSettings.monthRange) return false;
  const nextMonth = first(
    '[aria-label*="next month" i], [title*="next month" i], [data-calendar-next], [data-next-month], .calendar-next, .p-datepicker-next',
    step.root
  );
  if (!nextMonth || !enabled(nextMonth) || !click(nextMonth, 1000)) return false;
  if (currentMonth) state.visitedMonths.add(currentMonth);
  state.selected = null;
  state.continueSent = false;
  state.nextAttemptAt = Date.now() + 500;
  persistCalendarRetry(state);
  updateStage('Calendar search', '95%', `Moving to the next available calendar month (${state.visitedMonths.size + 1}/${automationSettings.monthRange}).`);
  scheduleWorkflow(500);
  return true;
}
function persistCalendarRetry(state) {
  calendarResume = {
    tried: [...state.tried], nextAttemptAt: state.nextAttemptAt,
    attempts: state.attempts, cycle: state.cycle, visitedMonths: [...state.visitedMonths]
  };
  chrome.storage.local.set({ calendarRetry: calendarResume });
}
function availableCalendarDates(root) {
  const explicit = all(PAGE.dates, root);
  const standard = all(
    '[role="gridcell"] button, button[name="day"], button[data-day], ' +
    '.react-datepicker__day:not(.react-datepicker__day--disabled):not(.react-datepicker__day--outside-month), ' +
    '.rdp-day button, [role="grid"] button, .calendar button, ' +
    '[data-calendar] [role="button"], button[aria-label*="202" i]', root);
  // The supplied page has plain numeric day buttons, not .available classes.
  const plain = button(/^continue booking$/i, root) ?
    all('button, [role="button"]', root).filter(el => /^(?:[1-9]|[12][0-9]|3[01])$/.test(label(el))) : [];
  return [...new Set([...explicit, ...standard, ...plain])].filter(el => enabled(el) &&
    !el.closest('.disabled, .p-disabled, [aria-disabled="true"], [disabled], [data-disabled="true"], [data-outside="true"]') &&
    !el.matches?.('.react-datepicker__day--disabled, .react-datepicker__day--outside-month') &&
    label(el) && withinConfiguredMonthRange(el));
}
function performCalendarSearch(step) {
  if (paymentStageReached()) { finishAtPayment(); return; }
  if (!step.calendar) step.calendar = {
    tried: new Set(Array.isArray(calendarResume?.tried) ? calendarResume.tried : []),
    nextAttemptAt: Math.min(Number(calendarResume?.nextAttemptAt) || 0, Date.now() + SLOT_RETRY_MS),
    selected: null, continueSent: false, readyAt: 0,
    attempts: Number(calendarResume?.attempts) || 0, cycle: Number(calendarResume?.cycle) || 1,
    visitedMonths: new Set(Array.isArray(calendarResume?.visitedMonths) ? calendarResume.visitedMonths : [])
  };
  const state = step.calendar;
  const now = Date.now();
  const available = availableCalendarDates(step.root);
  const dates = [...new Map(available.map(el => [calendarDateKey(el), el])).values()];
  const thisMonth = monthKey(step.root, dates);
  if (thisMonth) state.visitedMonths.add(thisMonth);
  const count = document.getElementById('metric-dates');
  if (count) count.innerText = dates.length;
  const availableMetric = document.getElementById('metric-available');
  if (availableMetric) availableMetric.textContent = dates.length ? String(dates.length) : '—';

  if (!automationSettings.autoSlotRotation && !state.selected) {
    const selectedDate = dates.find(el => el.getAttribute('aria-selected') === 'true' ||
      el.getAttribute('aria-pressed') === 'true' || el.matches('.selected, .active, .is-selected, [data-selected="true"]') ||
      !!el.closest('.selected, .active, .is-selected, [data-selected="true"]'));
    if (!selectedDate) {
      updateStage('Calendar search', '95%', 'Auto slot rotation is off. Select an available date manually.');
      return;
    }
    state.selected = calendarDateKey(selectedDate);
    state.readyAt = now;
    state.continueSent = false;
    const tryingMetric = document.getElementById('metric-trying');
    if (tryingMetric) tryingMetric.textContent = state.selected.slice(0, 24);
  }

  // Continue once for this selected date, not repeatedly during the wait.
  if (state.selected && !state.continueSent && now >= state.readyAt) {
    const proceed = button(/^continue booking$/i, step.root);
    if (!automationSettings.autoNavigate) {
      updateStage('Calendar search', '95%', 'Date selected. Auto navigate is off; click Continue Booking manually.');
      return;
    }
    if (proceed && enabled(proceed) && click(proceed, SLOT_RETRY_MS)) {
      state.continueSent = true;
      step.submitted = true;
      // At least 20 seconds after sending Continue, even if it was slow to enable.
      state.nextAttemptAt = now + SLOT_RETRY_MS;
      persistCalendarRetry(state);
      logMessage('Continue Booking sent once. Waiting for payment/confirmation.');
      return;
    }
  }
  if (now < state.nextAttemptAt) {
    const seconds = Math.ceil((state.nextAttemptAt - now) / 1000);
    const metric = document.getElementById('metric-next');
    if (metric) metric.innerText = `${seconds}s`;
    updateStage('Calendar search', '95%', `Waiting for this date to proceed. Next date attempt in ${seconds}s.`);
    return;
  }
  if (!dates.length) {
    if (advanceCalendarMonth(step, state, thisMonth)) return;
    updateStage('Calendar search', '95%', 'No clickable dates are available. Continuing to watch the calendar.');
    return;
  }
  if (!automationSettings.autoSlotRotation) return;
  const ordered = sortCalendarDates(dates);
  let choice = ordered.find(el => !state.tried.has(calendarDateKey(el)));
  if (!choice) {
    if (advanceCalendarMonth(step, state, thisMonth)) return;
    state.tried.clear();
    state.cycle++;
    choice = ordered[0];
  }
  if (!click(choice)) return;
  const key = calendarDateKey(choice);
  state.tried.add(key);
  state.selected = key;
  state.continueSent = false;
  state.attempts++;
  state.readyAt = now;
  state.nextAttemptAt = now + SLOT_RETRY_MS;
  persistCalendarRetry(state);
  const cycle = document.getElementById('metric-cycle');
  if (cycle) cycle.innerText = state.cycle;
  const next = document.getElementById('metric-next');
  if (next) next.innerText = '20s';
  const tryingMetric = document.getElementById('metric-trying');
  if (tryingMetric) tryingMetric.textContent = key.slice(0, 24);
  updateStage('Calendar search', '95%', `Selected an available date (${automationSettings.slotRotation}) — attempt ${state.attempts}.`);
  // Re-scan after the site's date-change handler; do not add a fixed half-second wait.
  scheduleWorkflow(0);
}
function runManualStep(kind) {
  if (resetInProgress) return false;
  if (activeStep && activeStep.kind !== kind) {
    logMessage(`Waiting for ${activeStep.kind}; another step cannot start yet.`);
    return false;
  }
  return executeWorkflowSteps(kind);
}
function executeWorkflowSteps(requestedKind = null) {
  if (executing) return false;
  executing = true;
  try {
    // Stop BEFORE cleaning dialogs or dispatching actions on a financial page.
    if (paymentStageReached()) { finishAtPayment(); return true; }
    const metric = document.getElementById('metric-attempts');
    if (metric) metric.innerText = ++attemptCount;
    // Cleaner runs on EVERY scan, even while another step is pending.
    if (executePopupCleanup()) return true;
    if (requiredNoticeDialog()) {
      updateStage('Review IVAC notice', '50%', 'Read the notice and close it manually to resume automation.');
      return true;
    }
    const candidates = detectSteps();
    // An informational Next popup may interrupt a pending request. Continue it
    // without abandoning the original step or declaring that step successful.
    const nextPopup = candidates.find(s => s.kind === 'next' && s.interruption);
    if (nextPopup && activeStep && activeStep.kind !== 'next') {
      if (!popupContinuation || popupContinuation.el !== nextPopup.el) popupContinuation = newStep(nextPopup);
      performStep(popupContinuation);
      activeStep.absentSince = 0;
      return true;
    }
    if (popupContinuation?.submitted && !nextPopup) {
      trackerNextComplete = true;
      stepStatus.noticeConfirmed = true;
      revealTrackerStep('next');
      updateStepTrackerUI();
    }
    popupContinuation = null;
    if (activeStep?.kind === 'otp' && first(PAGE.otpOK, activeStep.root)) {
      status('otp', true);
      activeStep = null;
    }
    if (activeStep?.kind === 'mission' && first(PAGE.missionOK)) {
      status('mission', true);
      activeStep = null;
    }
    if (activeStep) {
      const current = candidates.find(s => s.kind === activeStep.kind);
      if (current) {
        activeStep.el = current.el;
        activeStep.root = current.root;
        activeStep.absentSince = 0;
      } else {
        const other = candidates.find(s => s.kind !== activeStep.kind &&
          (activeStep.kind !== 'otp' || !['otp', 'signIn', 'next'].includes(s.kind)));
        // The next workflow screen is itself often a modal. Only unrelated
        // overlays block the transition, not the modal containing that screen.
        const blocked = all(PAGE.dialogs).some(dialog => !other || !dialog.contains(other.el)) ||
          busy() || captchaPending();
        if (activeStep.kind === 'booking' && first(PAGE.booked)) {
          status('booking', true);
          activeStep = null;
          return true;
        }
        // A transiently missing input is NOT success. Require an actual submitted
        // action, another recognized step, no blockers, and a stable transition.
        const manualOTPTransition = activeStep.kind === 'otp' && otpSession?.manualPageInput;
        const uploadsConfirmed = activeStep.kind !== 'upload' ||
          (activeStep.uploadContinueSent && activeStep.uploadRecords?.every(record => record.done));
        if ((activeStep.submitted || manualOTPTransition) && uploadsConfirmed && other && !blocked) {
          if (!activeStep.absentSince) activeStep.absentSince = Date.now();
          if (Date.now() - activeStep.absentSince >= 1200) {
            // Leaving the calendar is not proof that a booking was confirmed.
            if (activeStep.kind !== 'booking') status(activeStep.kind, true);
            logMessage(`${activeStep.kind}: page transition confirmed.`);
            activeStep = null;
          }
        } else activeStep.absentSince = 0;
        if (activeStep) {
          updateStage('Waiting for confirmation', '50%', 'Current step is pending; other workflow actions are blocked.');
          return true;
        }
      }
    }
    // These are detections, not prerequisite flags: any available screen can be
    // the entry point. Nothing absent gets marked completed.
    if (!activeStep) {
      const candidate = requestedKind ? candidates.find(s => s.kind === requestedKind) : candidates[0];
      if (!candidate) {
        updateStage('Watching page', '0%', 'Waiting for a recognized step or manual confirmation.');
        return false;
      }
      activeStep = newStep(candidate);
    }
    if (captchaPending() || busy()) {
      updateStage('Waiting', '50%', captchaPending() ?
        'Complete the CAPTCHA manually; waiting for verification.' : 'Waiting for page loading to finish.');
      return true;
    }
    // Unknown dialogs block clicks underneath them, but are never force-removed.
    const dialogs = all(PAGE.dialogs);
    if (dialogs.length && !dialogs.some(d => d.contains(activeStep.el))) return true;
    performStep(activeStep);
    return true;
  } catch (error) {
    logMessage(`Workflow paused for retry: ${error.message}`);
    return false;
  } finally {
    executing = false;
    updateStepTrackerUI();
    scheduleWorkflow(activeStep?.kind === 'otp' && !otpSession?.submitted &&
      !otpSession?.awaitingManualSubmit && automationSettings.autoOtpFill ? 100 : undefined);
  }
}

// Capture user interaction without treating our synthetic fill/click as manual.
document.addEventListener?.('input', observeManualOTP, true);
document.addEventListener?.('click', observeManualOTP, true);
document.addEventListener?.('submit', observeManualOTP, true);
document.addEventListener?.('click', observeManualWorkflowAction, true);
document.addEventListener?.('submit', observeManualWorkflowAction, true);

// Reopen the panel from Chrome's toolbar without resetting the active page.
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'RESET_AUTOMATOR_STATE') {
      resetPanelState();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type !== 'OPEN_AUTOMATOR_PANEL') return false;
    createFloatingPanel();
    sendResponse({ ok: true });
    return false;
  });
}

// Auto-inject only on the exact host allowed by the manifest.
if (window.location.hostname === 'appointment.ivacbd.com') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', createFloatingPanel);
  } else {
    createFloatingPanel();
  }
}