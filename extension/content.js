// Visa Automator Pro — adaptive, completion-driven content script.
// Used by the complete Manifest V3 extension and as a drop-in content-script update.
let automatorInterval = null;
let isRunning = false;
const FILE_SLOTS = [1, 2, 3, 4];
let uploadedFilesMap = { 1: null, 2: null, 3: null, 4: null };
let primarySlotKey = null;
let storageGeneration = 0;
let resetInProgress = false;
let currentStageDetail = '';
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
  { kind: 'next', key: null, id: 'step-next', title: 'Continue popup' }
];

// Step Completion Tracking State
let stepStatus = {
  signIn: false,
  otpVerified: false,
  popupsCleaned: false,
  takeAppointmentClicked: false,
  filesUploaded: false,
  missionSelected: false,
  slotBooked: false,
  paymentReached: false
};

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

  chrome.storage.local.get(['panelPos', 'savedPhone', 'savedPass', 'primarySlot', 'savedMission', 'savedCenter', 'savedFilesMap', 'automatorRunning', 'calendarRetry'], async (result) => {
    panelCreating = false;
    if (generation !== storageGeneration || resetInProgress) return;
    const posX = result.panelPos?.x || '30px';
    const posY = result.panelPos?.y || '30px';
    const isRight = result.panelPos?.right !== undefined ? result.panelPos.right : '30px';
    if (result.primarySlot) primarySlotKey = result.primarySlot;
    calendarResume = result.calendarRetry || null;

    if (result.savedFilesMap) {
      FILE_SLOTS.forEach(slot => {
        if (result.savedFilesMap[slot]) uploadedFilesMap[slot] = base64ToFile(result.savedFilesMap[slot]);
      });
    }

    const panelHTML = `
      <div id="visa-automator-floating-panel" style="position: fixed; top: ${posY}; right: ${isRight}; left: ${posX}; width: 320px; max-width: calc(100vw - 16px); background: #0c0d12; color: #fff; z-index: 999999; border-radius: 11px; box-shadow: 0 10px 28px rgba(0,0,0,0.8); font-family: sans-serif; border: 1px solid #1f2030;">
        <style>
          @keyframes va-step-spin { to { transform: rotate(360deg); } }
          #visa-automator-floating-panel input { min-width: 0; }
          #visa-automator-floating-panel * { box-sizing: border-box; }
          #workflow-indicator { flex: 0 0 auto; width: 11px; height: 11px; color: #00ff88; }
          #workflow-indicator.va-working { border: 2px solid #00b35944; border-top-color: #00ff88; border-radius: 50%; animation: va-step-spin .8s linear infinite; }
          @media (prefers-reduced-motion: reduce) { #workflow-indicator.va-working { animation: none; } }
        </style>
        
        <!-- Top Header / Branding -->
        <div id="panel-header" style="background: #13141d; padding: 10px 14px; cursor: move; display: flex; justify-content: space-between; align-items: center; border-top-left-radius: 14px; border-top-right-radius: 14px; border-bottom: 1px solid #1f2030;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="background: #ffcc00; width: 8px; height: 8px; border-radius: 50%;"></span>
            <span style="font-weight: bold; font-size: 13px; letter-spacing: 0.5px;">Visa Automator</span>
            <span style="font-size: 9px; background: #ffcc0022; color: #ffcc00; padding: 2px 6px; border-radius: 4px;">PRO 2.1</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="reset-panel" title="Stop automation and erase all saved extension data" style="background: #34202a; border: 1px solid #774052; color: #ffb4be; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 9px;">RESET</button>
            <button id="minimize-panel" style="background: none; border: none; color: #777; cursor: pointer; font-size: 12px;">_</button>
            <button id="close-panel" style="background: none; border: none; color: #777; cursor: pointer; font-size: 13px;">✕</button>
          </div>
        </div>

        <div id="panel-content" style="padding: 14px; max-height: 590px; overflow-y: auto;">
          
          <!-- Profile & Language Header -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #888;">
              <span>PROFILE</span>
              <span style="background: #00b35933; color: #00ff88; padding: 3px 10px; border-radius: 12px; font-weight: bold; border: 1px solid #00b35955;">Person 1</span>
            </div>
            <div style="display: flex; gap: 4px;">
              <button style="background: #00b359; border: none; color: #fff; font-size: 10px; padding: 2px 6px; border-radius: 4px; cursor: pointer;">EN</button>
              <button style="background: #1a1b26; border: none; color: #aaa; font-size: 10px; padding: 2px 6px; border-radius: 4px; cursor: pointer;">বাংলা</button>
              <span style="background: #00ff8822; color: #00ff88; font-size: 10px; padding: 2px 8px; border-radius: 10px; border: 1px solid #00ff8844;">● trial</span>
            </div>
          </div>

          <!-- Stage Progress Card -->
          <div id="legacy-stage-card" style="display: none; background: #13141d; padding: 10px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #1f2030;">
            <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 6px;">
              <span style="color: #888;">STAGE: <b id="current-stage-txt" style="color: #fff;">Waiting for page</b></span>
              <span style="background: #1a1b26; color: #aaa; padding: 2px 6px; border-radius: 4px; font-size: 10px;">IDLE</span>
            </div>
            <div style="background: #1a1b26; height: 4px; border-radius: 2px; margin-bottom: 6px; overflow: hidden;">
              <div id="progress-bar" style="background: #00ff88; width: 10%; height: 100%; transition: width 0.3s;"></div>
            </div>
            <div id="stage-desc" style="font-size: 10px; color: #666;">Waiting for the page...</div>
          </div>

          <!-- Navigation Tabs -->
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 14px;">
            <button id="tab-run-btn" style="background: #00b359; border: none; color: #fff; padding: 6px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer;">▶ RUN & MANUAL</button>
            <button id="tab-config-btn" style="background: #161722; border: none; color: #aaa; padding: 6px; border-radius: 6px; font-size: 11px; cursor: pointer;">⚙ CONFIG</button>
            <button id="tab-license-btn" style="background: #161722; border: none; color: #aaa; padding: 6px; border-radius: 6px; font-size: 11px; cursor: pointer;">📄 LICENSE</button>
          </div>

          <!-- RUN TAB -->
          <div id="view-run" class="tab-view">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
              <div>
                <label style="font-size: 9px; color: #777;">PHONE</label>
                <input type="text" id="phone-field" placeholder="Phone" style="width: 100%; background: #161722; border: 1px solid #28293d; color: #fff; padding: 6px; border-radius: 6px; font-size: 11px; box-sizing: border-box;" />
              </div>
              <div>
                <label style="font-size: 9px; color: #777;">PASSWORD</label>
                <input type="password" id="pass-field" placeholder="Password" style="width: 100%; background: #161722; border: 1px solid #28293d; color: #fff; padding: 6px; border-radius: 6px; font-size: 11px; box-sizing: border-box;" />
              </div>
            </div>

            <!-- OTP Input Section -->
            <section style="background:#13141d;padding:8px;border:1px solid #28293d;border-radius:8px;margin-bottom:8px;font-size:11px;">
              <label style="display:flex;align-items:center;gap:7px;font-weight:bold;cursor:pointer;">
                <input id="phone-otp-toggle" type="checkbox" style="accent-color:#00b96c;"> Phone OTP auto-fill
              </label>
              <div style="display:flex;gap:5px;align-items:center;margin-top:7px;">
                <input id="phone-client-key" aria-label="Client Key" readonly placeholder="CLIENT KEY" style="width:100%;font:700 13px monospace;letter-spacing:1px;color:#7ce7b3;background:#161722;border:1px solid #34384d;padding:6px;border-radius:5px;">
                <button id="phone-copy-key" title="Copy Client Key" style="padding:6px;background:#25283a;color:#eee;border:0;border-radius:5px;cursor:pointer;">Copy</button>
                <button id="phone-new-key" title="Regenerate key and unpair the old phone" style="padding:6px;background:#25283a;color:#eee;border:0;border-radius:5px;cursor:pointer;">New key</button>
              </div>
              <div style="display:flex;gap:6px;align-items:center;margin-top:6px;">
                <span id="phone-pair-status" role="status" style="color:#a6abbd;flex:1;font-size:10px;">Not paired</span>
                <button id="phone-relay-setup" style="border:0;background:transparent;color:#7ce7b3;cursor:pointer;font-size:10px;">Relay setup</button>
              </div>
            </section>
            <div style="background: #13141d; padding: 8px; border-radius: 8px; margin-bottom: 10px; border: 1px solid #1f2030; display: flex; align-items: center; gap: 8px;">
              <input type="text" id="otp-input-field" placeholder="Enter OTP" maxlength="6" style="flex: 1; background: #161722; border: 1px solid #28293d; color: #00ff88; text-align: center; padding: 6px; border-radius: 6px; font-size: 14px; letter-spacing: 2px; font-weight: bold;" />
              <button id="send-otp-btn" style="background: #222333; border: none; color: #ccc; padding: 7px 10px; border-radius: 6px; font-size: 10px; cursor: pointer;">FETCH OTP</button>
            </div>

            <!-- Controls -->
            <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 6px; margin-bottom: 12px;">
              <button id="start-btn" style="background: #ffcc00; border: none; color: #000; font-weight: bold; padding: 10px; border-radius: 8px; cursor: pointer; font-size: 12px;">▶ START</button>
              <button id="pause-btn" style="background: #1f2030; border: none; color: #ffcc00; padding: 10px; border-radius: 8px; cursor: pointer; font-size: 11px;">⏸ PAUSE</button>
              <button id="stop-btn" style="background: #331111; border: none; color: #ff5555; padding: 10px; border-radius: 8px; cursor: pointer; font-size: 11px;">⏹ STOP</button>
            </div>

            <!-- Multi-Slot Webfiles UI with Primary Selector -->
            <div style="background: #13141d; padding: 8px; border-radius: 8px; margin-bottom: 10px; border: 1px solid #1f2030;">
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #888; margin-bottom: 6px;">
                <span>WEBFILES (Click slot to upload, Star for Primary)</span>
                <span id="webfile-status-count" style="color: #00ff88;">0 / 4</span>
              </div>
              
              <div style="display: flex; gap: 6px; margin-bottom: 6px;">
                <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                  <button class="webfile-slot-btn" data-slot="1" style="background: ${uploadedFilesMap[1] ? '#00b359' : '#161722'}; border: 1px solid #28293d; color: #aaa; padding: 6px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer;">1 ${primarySlotKey == 1 ? '[P]' : ''}</button>
                  <button class="primary-toggle-btn" data-slot="1" style="background: ${primarySlotKey == 1 ? '#00b35922' : '#161722'}; color: ${primarySlotKey == 1 ? '#00ff88' : '#666'}; border: none; font-size: 8px; padding: 2px; border-radius: 3px; cursor: pointer;">${primarySlotKey == 1 ? '★ Primary' : 'Make Primary'}</button>
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                  <button class="webfile-slot-btn" data-slot="2" style="background: ${uploadedFilesMap[2] ? '#00b359' : '#161722'}; border: 1px solid #28293d; color: #aaa; padding: 6px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer;">2 ${primarySlotKey == 2 ? '[P]' : ''}</button>
                  <button class="primary-toggle-btn" data-slot="2" style="background: ${primarySlotKey == 2 ? '#00b35922' : '#161722'}; color: ${primarySlotKey == 2 ? '#00ff88' : '#666'}; border: none; font-size: 8px; padding: 2px; border-radius: 3px; cursor: pointer;">${primarySlotKey == 2 ? '★ Primary' : 'Make Primary'}</button>
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                  <button class="webfile-slot-btn" data-slot="3" style="background: ${uploadedFilesMap[3] ? '#00b359' : '#161722'}; border: 1px solid #28293d; color: #aaa; padding: 6px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer;">3 ${primarySlotKey == 3 ? '[P]' : ''}</button>
                  <button class="primary-toggle-btn" data-slot="3" style="background: ${primarySlotKey == 3 ? '#00b35922' : '#161722'}; color: ${primarySlotKey == 3 ? '#00ff88' : '#666'}; border: none; font-size: 8px; padding: 2px; border-radius: 3px; cursor: pointer;">${primarySlotKey == 3 ? '★ Primary' : 'Make Primary'}</button>
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                  <button class="webfile-slot-btn" data-slot="4" style="background: ${uploadedFilesMap[4] ? '#00b359' : '#161722'}; border: 1px solid #28293d; color: #aaa; padding: 6px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer;">4 ${primarySlotKey == 4 ? '[P]' : ''}</button>
                  <button class="primary-toggle-btn" data-slot="4" style="background: ${primarySlotKey == 4 ? '#00b35922' : '#161722'}; color: ${primarySlotKey == 4 ? '#00ff88' : '#666'}; border: none; font-size: 8px; padding: 2px; border-radius: 3px; cursor: pointer;">${primarySlotKey == 4 ? '★ Primary' : 'Make Primary'}</button>
                </div>
              </div>

              <input type="file" id="slot-file-1" class="hidden-slot-input" data-slot="1" accept=".pdf" style="display: none;" />
              <input type="file" id="slot-file-2" class="hidden-slot-input" data-slot="2" accept=".pdf" style="display: none;" />
              <input type="file" id="slot-file-3" class="hidden-slot-input" data-slot="3" accept=".pdf" style="display: none;" />
              <input type="file" id="slot-file-4" class="hidden-slot-input" data-slot="4" accept=".pdf" style="display: none;" />
              
              <div id="slot-names-display" style="font-size: 9px; color: #666; text-align: center; margin-top: 4px;">Primary file will be uploaded first automatically.</div>
            </div>

            <!-- Exactly one live workflow status, with no completed/future list. -->
            <div style="background: #13141d; padding: 10px; border-radius: 8px; margin-bottom: 10px; border: 1px solid #1f2030;">
              <div style="font-size: 10px; font-weight: bold; color: #00ff88; margin-bottom: 6px; display: flex; justify-content: space-between;">
                <span>WORKFLOW PROGRESS</span>
                <span id="manual-file-quick-status" style="color: #aaa; font-weight: normal;">Files: 0/4</span>
              </div>
              
              <div id="workflow-status" role="status" aria-live="polite" aria-atomic="true" aria-busy="false" style="display: flex; align-items: center; gap: 8px; padding: 8px; background: #161722; border-radius: 6px;">
                <span id="workflow-indicator" aria-hidden="true">•</span>
                <div style="min-width: 0; flex: 1;">
                  <b id="workflow-title" style="font-size: 12px; color: #f5f7fb;">Ready</b>
                  <div id="workflow-detail" style="font-size: 10px; color: #9299a8; line-height: 1.4; margin-top: 3px;">Press Start to detect the current step.</div>
                </div>
                <button id="workflow-retry" style="font-size: 9px; padding: 5px 7px; border: 0; border-radius: 4px; background: #00b359; color: white; cursor: pointer;" hidden>Run</button>
              </div>
            </div>

            <!-- Metrics Counters -->
            <div style="display: flex; gap: 4px; margin-bottom: 10px;">
              <div style="flex: 1; background: #13141d; padding: 6px; border-radius: 6px; text-align: center; border: 1px solid #1f2030;">
                <div id="metric-attempts" style="font-size: 13px; font-weight: bold; color: #fff;">0</div>
                <div style="font-size: 8px; color: #666;">ATTEMPTS</div>
              </div>
              <div style="flex: 1; background: #13141d; padding: 6px; border-radius: 6px; text-align: center; border: 1px solid #1f2030;">
                <div id="metric-cycle" style="font-size: 13px; font-weight: bold; color: #fff;">1</div>
                <div style="font-size: 8px; color: #666;">CYCLE</div>
              </div>
              <div style="flex: 1; background: #13141d; padding: 6px; border-radius: 6px; text-align: center; border: 1px solid #1f2030;">
                <div id="metric-dates" style="font-size: 13px; font-weight: bold; color: #00ff88;">0</div>
                <div style="font-size: 8px; color: #666;">DATES</div>
              </div>
              <div style="flex: 1; background: #13141d; padding: 6px; border-radius: 6px; text-align: center; border: 1px solid #1f2030;">
                <div id="metric-next" style="font-size: 13px; font-weight: bold; color: #ffcc00;">-</div>
                <div style="font-size: 8px; color: #666;">NEXT IN</div>
              </div>
            </div>

            <!-- Logs -->
            <div style="background: #090a0f; padding: 8px; border-radius: 6px; font-size: 9px; color: #00ff88; height: 75px; overflow-y: auto; border: 1px solid #161722;">
              <div>> System ready with Take Appointment step integration...</div>
            </div>
          </div>

          <!-- CONFIG TAB VIEW -->
          <div id="view-config" class="tab-view" style="display: none;">
            <div style="font-size: 11px; font-weight: bold; color: #aaa; margin-bottom: 8px;">BOOKING SETTINGS</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
              <div>
                <label style="font-size: 9px; color: #777;">MISSION</label>
                <select id="config-mission" style="width: 100%; background: #161722; border: 1px solid #28293d; color: #fff; padding: 6px; border-radius: 6px; font-size: 11px;">
                  <option>Dhaka</option>
                  <option>Chittagong</option>
                  <option>Rajshahi</option>
                  <option>Sylhet</option>
                  <option>Khulna</option>
                </select>
              </div>
              <div>
                <label style="font-size: 9px; color: #777;">IVAC CENTER</label>
                <select id="config-center" style="width: 100%; background: #161722; border: 1px solid #28293d; color: #fff; padding: 6px; border-radius: 6px; font-size: 11px;">
                  <option>IVAC, Dhaka (JFP)</option>
                  <option>IVAC, Chittagong</option>
                  <option>IVAC, Rajshahi</option>
                  <option>IVAC, Sylhet</option>
                  <option>IVAC, Khulna</option>
                </select>
              </div>
            </div>
          </div>

          <!-- LICENSE TAB VIEW -->
          <div id="view-license" class="tab-view" style="display: none; font-size: 11px; color: #aaa; text-align: center; padding: 20px;">
            <div style="color: #00ff88; font-weight: bold;">PRO LICENSE ACTIVE</div>
          </div>

        </div>
      </div>
    `;

    const div = document.createElement('div');
    div.innerHTML = panelHTML;
    document.body.appendChild(div);
    document.getElementById('phone-field').value = result.savedPhone || '';
    document.getElementById('pass-field').value = result.savedPass || '';
    compactPanel(document.getElementById('visa-automator-floating-panel'));

    updateSlotDisplayStatus();
    updateStepTrackerUI();

    const missionSelect = document.getElementById('config-mission');
    const centerSelect = document.getElementById('config-center');
    for (const select of [missionSelect, centerSelect]) {
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Select…';
      select.prepend(blank);
      select.value = '';
    }
    if (result.savedMission && missionSelect) missionSelect.value = result.savedMission;
    if (result.savedCenter && centerSelect) centerSelect.value = result.savedCenter;

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
    document.getElementById('tab-run-btn').addEventListener('click', () => switchTab('RUN', 'tab-run-btn'));
    document.getElementById('tab-config-btn').addEventListener('click', () => switchTab('CONFIG', 'tab-config-btn'));
    document.getElementById('tab-license-btn').addEventListener('click', () => switchTab('LICENSE', 'tab-license-btn'));

    function switchTab(tabName, btnId) {
      document.querySelectorAll('.tab-view').forEach(el => el.style.display = 'none');
      document.querySelectorAll('[id^="tab-"]').forEach(b => { b.style.background = '#161722'; b.style.color = '#aaa'; });
      document.getElementById(`view-${tabName.toLowerCase()}`).style.display = 'block';
      const activeBtn = document.getElementById(btnId);
      activeBtn.style.background = '#00b359';
      activeBtn.style.color = '#fff';
    }

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
          logMessage(`Slot ${slotNum} loaded: ${file.name}`);

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
          b.innerText = 'Make Primary';
        });
        document.querySelectorAll('.webfile-slot-btn').forEach(b => {
          b.style.background = '#161722';
        });

        btn.style.background = '#00b35922';
        btn.style.color = '#00ff88';
        btn.innerText = '★ Primary';

        const activeSlotBtn = document.querySelector(`.webfile-slot-btn[data-slot="${slotNum}"]`);
        if (uploadedFilesMap[slotNum]) activeSlotBtn.style.background = '#00b359';
        document.querySelectorAll('.webfile-slot-btn').forEach(b => {
          b.textContent = `${b.dataset.slot}${b.dataset.slot == primarySlotKey ? ' [P]' : ''}`;
        });
        updateSlotDisplayStatus();

        logMessage(`Slot ${slotNum} set as Primary File.`);
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

    document.getElementById('stop-btn').addEventListener('click', () => {
      stopAutomation();
      chrome.storage.local.set({ automatorRunning: false });
    });

    document.getElementById('send-otp-btn').addEventListener('click', () => {
      pollOTPFromBackground();
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
  if (quickStatus) quickStatus.innerText = `Files: ${count}/4`;

  const statusDesc = document.getElementById('slot-names-display');
  if (statusDesc) {
    let names = [];
    FILE_SLOTS.forEach(k => {
      if (uploadedFilesMap[k]) {
        let label = k == primarySlotKey ? `[Primary: ${uploadedFilesMap[k].name}]` : `${uploadedFilesMap[k].name}`;
        names.push(label);
      }
    });
    statusDesc.innerText = names.length > 0 ? names.join(' | ') : 'Primary file will be uploaded first automatically.';
  }
}

function updateStepTrackerUI() {
  const box = document.getElementById('workflow-status');
  if (!box) return;
  const current = cleanupPending ? 'popups' : popupContinuation?.kind || activeStep?.kind;
  const step = TRACKER_STEPS.find(item => item.kind === current);
  const last = [...trackerHistory].reverse().find(kind => {
    const item = TRACKER_STEPS.find(s => s.kind === kind);
    return item?.key ? stepStatus[item.key] : kind === 'next' && trackerNextComplete;
  });
  const complete = stepStatus.paymentReached || (!current && !!last);
  const working = isRunning && !resetInProgress;
  const title = resetInProgress ? 'Resetting…' : stepStatus.paymentReached ? 'Payment / confirmation reached' : step?.title ||
    (isRunning ? 'Detecting current step' : complete ? 'Step completed' : 'Ready');
  document.getElementById('workflow-title').textContent = title;
  document.getElementById('workflow-detail').textContent = resetInProgress ? 'Clearing all saved extension data…' :
    !isRunning && current ? 'Stopped. Press Start to resume detection.' :
    currentStageDetail || (working ? 'Watching the page for available elements…' :
    complete ? 'Press Start to continue from the current page.' : 'Press Start to detect the current step.');
  const indicator = document.getElementById('workflow-indicator');
  indicator.className = working || resetInProgress ? 'va-working' : '';
  indicator.textContent = working || resetInProgress ? '' : complete ? '✓' : '•';
  box.setAttribute('aria-busy', String(working || resetInProgress));
  const retry = document.getElementById('workflow-retry');
  retry.hidden = !activeStep || working || resetInProgress;
  retry.disabled = resetInProgress;
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
  uploadedFilesMap = { 1: null, 2: null, 3: null, 4: null };
  primarySlotKey = null;
  attemptCount = 0;
  currentStageDetail = '';
  const panel = document.getElementById('visa-automator-floating-panel');
  if (panel) {
    panel.querySelectorAll('input, select').forEach(el => { el.value = ''; });
    panel.querySelectorAll('.webfile-slot-btn').forEach(el => {
      el.textContent = el.dataset.slot;
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
    const log = panel.querySelector('#view-run > div:last-child');
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
  const logBox = document.querySelector('#view-run > div:last-child');
  if (logBox) {
    const entry = document.createElement('div');
    entry.textContent = `> ${msg}`;
    logBox.appendChild(entry);
    while (logBox.children.length > 150) logBox.firstElementChild.remove();
    logBox.scrollTop = logBox.scrollHeight;
  }
}

function updateStage(stageName, progressWidth, desc = '') {
  currentStageDetail = desc;
  const stageTxt = document.getElementById('current-stage-txt');
  const progressBar = document.getElementById('progress-bar');
  const stageDesc = document.getElementById('stage-desc');
  if (stageTxt) stageTxt.innerText = stageName;
  if (progressBar) progressBar.style.width = progressWidth;
  if (stageDesc && desc) stageDesc.innerText = desc;
  updateStepTrackerUI();
}

function startAutomation() {
  if (isRunning || resetInProgress) return;
  isRunning = true;
  chrome.storage.local.set({ automatorRunning: true });
  logMessage('Adaptive automation started. Waiting for verified page transitions.');
  workflowObserver = new MutationObserver(records => {
    // Ignore panel-only changes so logging does not trigger an endless observer loop.
    if (records.some(r => !inPanel(r.target))) scheduleWorkflow(100);
  });
  workflowObserver.observe(document.body, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-busy', 'aria-checked', 'data-status']
  });
  updateStepTrackerUI();
  executeWorkflowSteps();
}

function stopAutomation() {
  isRunning = false;
  otpRequestVersion++;
  if (otpSession) otpSession.fetchPending = false;
  clearTimeout(automatorInterval);
  automatorInterval = null;
  workflowObserver?.disconnect();
  workflowObserver = null;
  chrome.storage.local.set({ automatorRunning: false });
  updateStepTrackerUI();
  logMessage('Automation stopped.');
}

function pushManualOTP() {
  return runManualStep('otp');
}

function getOTPSession() {
  if (!otpSession) otpSession = {
    attempted: new Set(), submitted: false, manualPageInput: false,
    revision: 0, fetchPending: false, nextFetchAt: 0, fetchFailures: 0
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
function pollOTPFromBackground(automatic = false) {
  const generation = storageGeneration;
  const session = getOTPSession();
  const rejected = activeStep?.kind === 'otp' && !!first(PAGE.otpError, activeStep.root);
  if (resetInProgress || session.fetchPending || session.manualPageInput ||
    (session.submitted && !rejected) || (automatic && Date.now() < session.nextFetchAt)) return;
  const revision = session.revision;
  const requestVersion = ++otpRequestVersion;
  session.fetchPending = true;
  // 120 requests/minute stays below the relay's 180/minute browser limit.
  session.nextFetchAt = Date.now() + 500;
  const failed = () => {
    session.fetchFailures++;
    session.nextFetchAt = Date.now() + Math.min(20000, 5000 * 2 ** Math.min(session.fetchFailures, 2));
    if (!automatic) logMessage('OTP service unavailable. Waiting; manual OTP entry is still available.');
  };
  try {
    if (!chrome.runtime?.id) {
      session.fetchPending = false;
      failed();
      return;
    }
    chrome.runtime.sendMessage({ type: 'FETCH_OTP' }, (response) => {
      session.fetchPending = false;
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
      if (data && data.success && data.otp) {
        const code = otpCode(data.otp);
        if (!/^\d{4,10}$/.test(code) || session.attempted.has(code)) return;
        const field = first(PAGE.otp);
        if (field && !validOTP(code, field)) return;
        const otpFieldBox = document.getElementById('otp-input-field');
        if (otpFieldBox) otpFieldBox.value = code;
        session.relayMessageId = data.messageId || null;
        session.relayCode = code;
        logMessage('Fetched OTP successfully.');
        pushManualOTP();
      }
    });
  } catch (err) {
    session.fetchPending = false;
    failed();
  }
}

const OTP_SUBMIT_LABEL = /^(verify(?: otp| code)?|submit|confirm(?: otp| code)?|verify\s*(?:&|and)\s*continue)$/i;
function submitOTPOnce(step, verify) {
  const session = getOTPSession();
  const code = otpCode(step.el.value);
  const rejected = !!first(PAGE.otpError, step.root);
  if (session.manualPageInput || session.attempted.has(code) ||
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
  if (session.relayMessageId && session.relayCode === code) {
    chrome.runtime.sendMessage({ type: 'PHONE_ACK_OTP', messageId: session.relayMessageId }, () => {
      // Access lastError to suppress an unhandled worker-disconnect warning.
      if (chrome.runtime.lastError) logMessage('OTP receipt could not be saved; this session will still never resubmit the code.');
    });
  }
  updateStage('OTP verification', '30%', 'OTP submitted once. Waiting for verification; no automatic resubmission.');
  logMessage('OTP submitted once; waiting for the verified page transition.');
  return true;
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
  const code = otpCode(document.getElementById('otp-input-field')?.value);
  if (validOTP(code, step.el) && !session.attempted.has(code)) {
    setValue(step.el, code);
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
  session.manualPageInput = true;
  session.submitted = true;
  session.revision++;
  if (activeStep?.kind === 'otp') activeStep.submitted = true;
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
  upload: 'filesUploaded', mission: 'missionSelected', booking: 'slotBooked'
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
function scheduleWorkflow(delay = 700) {
  if (!isRunning) return;
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
function workflowDialog(root) {
  return !!button(NEXT_LABEL, root) || !!button(DETAILS_LABEL, root) ||
    !!button(/^confirm all information is correct$/i, root) ||
    !!button(CENTER_CONFIRM_LABEL, root) || !!button(/^continue booking$/i, root);
}
function hasWorkflowControls(root) {
  return !!first(`${PAGE.otp}, ${PAGE.phone}, input[type="password"], ${PAGE.mission}, ${PAGE.center}`, root) ||
    fileInputs(root).length > 0 || !!first(PAGE.captcha, root);
}
function executePopupCleanup() {
  let closed = false;
  const dialogs = all(PAGE.dialogs).reverse();
  for (const dialog of dialogs) {
    // Never destroy a live OTP, CAPTCHA, document or other data-entry form.
    if (workflowDialog(dialog) || hasWorkflowControls(dialog) || first('input:not([type="hidden"]), select, textarea', dialog)) continue;
    const dismiss = all('button, a, [role="button"]', dialog).find(el =>
      /^(close|cancel|dismiss|not now|no thanks|ok|okay|got it|×|✕|x)$/i.test(label(el)) ||
      el.matches('.modal-close, .swal2-close, [data-dismiss="modal"], [data-bs-dismiss="modal"]'));
    if (dismiss && click(dismiss, 1200)) closed = true;
  }
  // Standalone close controls, but never unrelated position:absolute buttons.
  for (const el of all('.modal-close, button[aria-label="Close"], button[aria-label="Dismiss"], [data-bs-dismiss="modal"], [data-dismiss="modal"]')) {
    const host = el.closest(PAGE.dialogs);
    if (host && !workflowDialog(host) && !hasWorkflowControls(host) && !first('input:not([type="hidden"]), select, textarea', host)) {
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
  if (kind === 'next') trackerNextComplete = done;
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
  if (Date.now() < step.nextTry || !el || busy(step.root) || captchaPending(step.root)) return false;
  if (!click(el)) return false;
  step.tries++;
  step.submitted = true;
  // Persistent retries, capped at a 20-second interval, never rapid-fire requests.
  step.nextTry = Date.now() + Math.min(20000, 3000 * 2 ** Math.min(step.tries - 1, 3));
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
      updateStage('Open sign-in', '5%', 'Opening the sign-in form before filling credentials.');
      submitStep(step, step.el);
      break;
    case 'signIn': {
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
function orderedUploadFiles() {
  return [primarySlotKey, ...FILE_SLOTS.filter(k => k != primarySlotKey)]
    .map(k => uploadedFilesMap[k]).filter(Boolean);
}
function uploadReceipt(input) {
  return JSON.stringify([input.dataset.uploadStatus || '', all(PAGE.uploadOK, uploadScope(input))
    .map(el => el.outerHTML || label(el))]);
}
function performUploads(step) {
  updateStage('Upload documents', '70%', 'Waiting for the primary document before secondary uploads.');
  const inputs = fileInputs(step.root);
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
    const input = inputs.length === 1 ? inputs[0] : inputs[i];
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
    activeStep = null;
    return;
  }
  const mission = first(PAGE.mission, step.root);
  if (mission && !usableOption(mission.options[mission.selectedIndex])) {
    updateStage('Mission / center', '85%', 'Waiting for the page to select its mission.');
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
  if (first(PAGE.booked)) status('booking', true);
  activeStep = null;
  popupContinuation = null;
  cleanupPending = false;
  calendarResume = null;
  chrome.storage.local.set({ calendarRetry: null });
  stopAutomation();
  updateStage('Payment / confirmation', '100%', 'Payment/confirmation reached. Automation stopped; review and continue manually.');
  const next = document.getElementById('metric-next');
  if (next) next.innerText = '-';
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
function persistCalendarRetry(state) {
  calendarResume = {
    tried: [...state.tried], nextAttemptAt: state.nextAttemptAt,
    attempts: state.attempts, cycle: state.cycle
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
    !el.matches?.('.react-datepicker__day--disabled, .react-datepicker__day--outside-month') && label(el));
}
function performCalendarSearch(step) {
  if (paymentStageReached()) { finishAtPayment(); return; }
  if (!step.calendar) step.calendar = {
    tried: new Set(Array.isArray(calendarResume?.tried) ? calendarResume.tried : []),
    nextAttemptAt: Math.min(Number(calendarResume?.nextAttemptAt) || 0, Date.now() + SLOT_RETRY_MS),
    selected: null, continueSent: false, readyAt: 0,
    attempts: Number(calendarResume?.attempts) || 0, cycle: Number(calendarResume?.cycle) || 1
  };
  const state = step.calendar;
  const now = Date.now();
  const available = availableCalendarDates(step.root);
  const dates = [...new Map(available.map(el => [calendarDateKey(el), el])).values()];
  const count = document.getElementById('metric-dates');
  if (count) count.innerText = dates.length;
  // Continue once for this selected date, not repeatedly during the wait.
  if (state.selected && !state.continueSent && now >= state.readyAt) {
    const proceed = button(/^continue booking$/i, step.root);
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
    updateStage('Calendar search', '95%', 'No clickable dates are available. Continuing to watch the calendar.');
    return;
  }
  const ordered = middleOut(dates);
  let choice = ordered.find(el => !state.tried.has(calendarDateKey(el)));
  if (!choice) {
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
  updateStage('Calendar search', '95%', `Selected an available date from the middle-first list (attempt ${state.attempts}).`);
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
      revealTrackerStep('next');
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
    scheduleWorkflow(activeStep?.kind === 'otp' && !otpSession?.submitted ? 100 : 300);
  }
}

// Capture user interaction without treating our synthetic fill/click as manual.
document.addEventListener?.('input', observeManualOTP, true);
document.addEventListener?.('click', observeManualOTP, true);
document.addEventListener?.('submit', observeManualOTP, true);

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