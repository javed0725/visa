// Visa Automator Pro — adaptive, completion-driven content script.
// Used by the complete Manifest V3 extension and as a drop-in content-script update.
let automatorInterval = null;
let isRunning = false;
let uploadedFilesMap = { 1: null, 2: null, 3: null };
let primarySlotKey = 1; // Default slot 1 is primary

// Step Completion Tracking State
let stepStatus = {
  signIn: false,
  otpVerified: false,
  popupsCleaned: false,
  takeAppointmentClicked: false,
  filesUploaded: false,
  missionSelected: false,
  slotBooked: false
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
  if (document.getElementById('visa-automator-floating-panel')) return;

  chrome.storage.local.get(['panelPos', 'savedPhone', 'savedPass', 'primarySlot', 'savedMission', 'savedCenter', 'savedFilesMap', 'automatorRunning'], async (result) => {
    const posX = result.panelPos?.x || '30px';
    const posY = result.panelPos?.y || '30px';
    const isRight = result.panelPos?.right !== undefined ? result.panelPos.right : '30px';
    if (result.primarySlot) primarySlotKey = result.primarySlot;

    if (result.savedFilesMap) {
      if (result.savedFilesMap[1]) uploadedFilesMap[1] = base64ToFile(result.savedFilesMap[1]);
      if (result.savedFilesMap[2]) uploadedFilesMap[2] = base64ToFile(result.savedFilesMap[2]);
      if (result.savedFilesMap[3]) uploadedFilesMap[3] = base64ToFile(result.savedFilesMap[3]);
    }

    const panelHTML = `
      <div id="visa-automator-floating-panel" style="position: fixed; top: ${posY}; right: ${isRight}; left: ${posX}; width: 390px; background: #0c0d12; color: #fff; z-index: 999999; border-radius: 14px; box-shadow: 0 15px 40px rgba(0,0,0,0.8); font-family: sans-serif; border: 1px solid #1f2030;">
        
        <!-- Top Header / Branding -->
        <div id="panel-header" style="background: #13141d; padding: 10px 14px; cursor: move; display: flex; justify-content: space-between; align-items: center; border-top-left-radius: 14px; border-top-right-radius: 14px; border-bottom: 1px solid #1f2030;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="background: #ffcc00; width: 8px; height: 8px; border-radius: 50%;"></span>
            <span style="font-weight: bold; font-size: 13px; letter-spacing: 0.5px;">Visa Automator</span>
            <span style="font-size: 9px; background: #ffcc0022; color: #ffcc00; padding: 2px 6px; border-radius: 4px;">PRO - 15.11</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="minimize-panel" style="background: none; border: none; color: #777; cursor: pointer; font-size: 12px;">_</button>
            <button id="close-panel" style="background: none; border: none; color: #777; cursor: pointer; font-size: 13px;">✕</button>
          </div>
        </div>

        <div style="padding: 14px; max-height: 590px; overflow-y: auto;">
          
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
          <div style="background: #13141d; padding: 10px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #1f2030;">
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
                <input type="text" id="phone-field" value="${result.savedPhone || '01799147785'}" style="width: 100%; background: #161722; border: 1px solid #28293d; color: #fff; padding: 6px; border-radius: 6px; font-size: 11px; box-sizing: border-box;" />
              </div>
              <div>
                <label style="font-size: 9px; color: #777;">PASSWORD</label>
                <input type="password" id="pass-field" value="${result.savedPass || ''}" placeholder="Password" style="width: 100%; background: #161722; border: 1px solid #28293d; color: #fff; padding: 6px; border-radius: 6px; font-size: 11px; box-sizing: border-box;" />
              </div>
            </div>

            <!-- OTP Input Section -->
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
                <span id="webfile-status-count" style="color: #00ff88;">0 / 3</span>
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
              </div>

              <input type="file" id="slot-file-1" class="hidden-slot-input" data-slot="1" accept=".pdf" style="display: none;" />
              <input type="file" id="slot-file-2" class="hidden-slot-input" data-slot="2" accept=".pdf" style="display: none;" />
              <input type="file" id="slot-file-3" class="hidden-slot-input" data-slot="3" accept=".pdf" style="display: none;" />
              
              <div id="slot-names-display" style="font-size: 9px; color: #666; text-align: center; margin-top: 4px;">Primary file will be uploaded first automatically.</div>
            </div>

            <!-- INTEGRATED MANUAL SECTION & STEP PUSH BUTTONS WITH "TAKE APPOINTMENT" -->
            <div style="background: #13141d; padding: 10px; border-radius: 8px; margin-bottom: 10px; border: 1px solid #1f2030;">
              <div style="font-size: 10px; font-weight: bold; color: #00ff88; margin-bottom: 6px; display: flex; justify-content: space-between;">
                <span>🛠 MANUAL STEP CONTROLLER & PUSH</span>
                <span id="manual-file-quick-status" style="color: #aaa; font-weight: normal;">Files: 0/3</span>
              </div>
              
              <div style="display: flex; flex-direction: column; gap: 5px; font-size: 11px;">
                <!-- Step 1 -->
                <div style="display: flex; justify-content: space-between; align-items: center; background: #161722; padding: 4px 8px; border-radius: 5px;">
                  <span style="color: #ccc;">1. Sign In <b id="step-sign-in" style="color: #666;">⏳</b></span>
                  <button id="push-signin-btn" style="background: #00b359; border: none; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 9px; cursor: pointer; font-weight: bold;">Push</button>
                </div>
                <!-- Step 2 -->
                <div style="display: flex; justify-content: space-between; align-items: center; background: #161722; padding: 4px 8px; border-radius: 5px;">
                  <span style="color: #ccc;">2. OTP Verify <b id="step-otp" style="color: #666;">⏳</b></span>
                  <button id="push-otp-btn" style="background: #00b359; border: none; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 9px; cursor: pointer; font-weight: bold;">Push</button>
                </div>
                <!-- Step 3 -->
                <div style="display: flex; justify-content: space-between; align-items: center; background: #161722; padding: 4px 8px; border-radius: 5px;">
                  <span style="color: #ccc;">3. Clean Popups <b id="step-popups" style="color: #666;">⏳</b></span>
                  <button id="push-popups-btn" style="background: #00b359; border: none; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 9px; cursor: pointer; font-weight: bold;">Push</button>
                </div>
                <!-- Step 4 -->
                <div style="display: flex; justify-content: space-between; align-items: center; background: #161722; padding: 4px 8px; border-radius: 5px;">
                  <span style="color: #ccc;">4. Take Appointment <b id="step-take-app" style="color: #666;">⏳</b></span>
                  <button id="push-take-app-btn" style="background: #00b359; border: none; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 9px; cursor: pointer; font-weight: bold;">Push</button>
                </div>
                <!-- Step 5 -->
                <div style="display: flex; justify-content: space-between; align-items: center; background: #161722; padding: 4px 8px; border-radius: 5px;">
                  <span style="color: #ccc;">5. Upload Files <b id="step-upload" style="color: #666;">⏳</b></span>
                  <button id="push-upload-btn" style="background: #00b359; border: none; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 9px; cursor: pointer; font-weight: bold;">Push</button>
                </div>
                <!-- Step 6 -->
                <div style="display: flex; justify-content: space-between; align-items: center; background: #161722; padding: 4px 8px; border-radius: 5px;">
                  <span style="color: #ccc;">6. Mission/Center <b id="step-mission" style="color: #666;">⏳</b></span>
                  <button id="push-mission-btn" style="background: #00b359; border: none; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 9px; cursor: pointer; font-weight: bold;">Push</button>
                </div>
                <!-- Step 7 -->
                <div style="display: flex; justify-content: space-between; align-items: center; background: #161722; padding: 4px 8px; border-radius: 5px;">
                  <span style="color: #ccc;">7. Slot Booking <b id="step-booking" style="color: #666;">⏳</b></span>
                  <button id="push-booking-btn" style="background: #ffcc00; border: none; color: #000; padding: 2px 6px; border-radius: 4px; font-size: 9px; cursor: pointer; font-weight: bold;">Push</button>
                </div>
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

    updateSlotDisplayStatus();
    updateStepTrackerUI();

    const missionSelect = document.getElementById('config-mission');
    const centerSelect = document.getElementById('config-center');
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

    // Step Push Button Listeners
    document.getElementById('push-signin-btn').addEventListener('click', () => {
      logMessage('Manual Push: Executing Sign In...');
      executeSignInStep();
    });
    document.getElementById('push-otp-btn').addEventListener('click', () => {
      logMessage('Manual Push: Verifying OTP...');
      pushManualOTP();
    });
    document.getElementById('push-popups-btn').addEventListener('click', () => {
      logMessage('Manual Push: Cleaning Popups...');
      executePopupCleanup();
    });
    document.getElementById('push-take-app-btn').addEventListener('click', () => {
      logMessage('Manual Push: Clicking Take Appointment...');
      executeTakeAppointmentStep();
    });
    document.getElementById('push-upload-btn').addEventListener('click', () => {
      logMessage('Manual Push: Uploading Webfiles...');
      executeFileUploadLogic();
    });
    document.getElementById('push-mission-btn').addEventListener('click', () => {
      logMessage('Manual Push: Selecting Mission & Center...');
      executeMissionSelection();
    });
    document.getElementById('push-booking-btn').addEventListener('click', () => {
      logMessage('Manual Push: Scanning Slots & Booking...');
      executeSlotBooking();
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
          uploadedFilesMap[slotNum] = file;
          const slotBtn = document.querySelector(`.webfile-slot-btn[data-slot="${slotNum}"]`);
          slotBtn.style.background = slotNum == primarySlotKey ? '#00b359' : '#28293d';
          slotBtn.style.color = '#fff';
          updateSlotDisplayStatus();
          logMessage(`Slot ${slotNum} loaded: ${file.name}`);

          try {
            const base64Data = await fileToBase64(file);
            chrome.storage.local.get(['savedFilesMap'], (res) => {
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

        logMessage(`Slot ${slotNum} set as Primary File.`);
      });
    });

    const panel = document.getElementById('visa-automator-floating-panel');
    const header = document.getElementById('panel-header');
    let isDragging = false, startX, startY;

    header.addEventListener('mousedown', (e) => {
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
    if (result.automatorRunning) startAutomation();
  });
}

function updateSlotDisplayStatus() {
  let count = 0;
  if (uploadedFilesMap[1]) count++;
  if (uploadedFilesMap[2]) count++;
  if (uploadedFilesMap[3]) count++;

  const countLbl = document.getElementById('webfile-status-count');
  if (countLbl) countLbl.innerText = `${count} / 3`;

  const quickStatus = document.getElementById('manual-file-quick-status');
  if (quickStatus) quickStatus.innerText = `Files: ${count}/3`;

  const statusDesc = document.getElementById('slot-names-display');
  if (statusDesc) {
    let names = [];
    [1, 2, 3].forEach(k => {
      if (uploadedFilesMap[k]) {
        let label = k == primarySlotKey ? `[Primary: ${uploadedFilesMap[k].name}]` : `${uploadedFilesMap[k].name}`;
        names.push(label);
      }
    });
    statusDesc.innerText = names.length > 0 ? names.join(' | ') : 'Primary file will be uploaded first automatically.';
  }
}

function updateStepTrackerUI() {
  const map = [
    { key: 'signIn', id: 'step-sign-in' },
    { key: 'otpVerified', id: 'step-otp' },
    { key: 'popupsCleaned', id: 'step-popups' },
    { key: 'takeAppointmentClicked', id: 'step-take-app' },
    { key: 'filesUploaded', id: 'step-upload' },
    { key: 'missionSelected', id: 'step-mission' },
    { key: 'slotBooked', id: 'step-booking' }
  ];

  map.forEach(item => {
    const elem = document.getElementById(item.id);
    if (elem) {
      if (stepStatus[item.key]) {
        elem.innerText = '✓';
        elem.style.color = '#00ff88';
        elem.style.fontWeight = 'bold';
      } else {
        elem.innerText = '⏳';
        elem.style.color = '#666';
      }
    }
  });
}

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
  const stageTxt = document.getElementById('current-stage-txt');
  const progressBar = document.getElementById('progress-bar');
  const stageDesc = document.getElementById('stage-desc');
  if (stageTxt) stageTxt.innerText = stageName;
  if (progressBar) progressBar.style.width = progressWidth;
  if (stageDesc && desc) stageDesc.innerText = desc;
}

function startAutomation() {
  if (isRunning) return;
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
  scheduleWorkflow(0);
}

function stopAutomation() {
  isRunning = false;
  clearTimeout(automatorInterval);
  automatorInterval = null;
  workflowObserver?.disconnect();
  workflowObserver = null;
  chrome.storage.local.set({ automatorRunning: false });
  logMessage('Automation stopped.');
}

function pushManualOTP() {
  return runManualStep('otp');
}

function pollOTPFromBackground() {
  try {
    if (!chrome.runtime?.id) {
      logMessage('Background context inactive. Please type OTP manually.');
      return;
    }
    
    chrome.runtime.sendMessage({ type: 'FETCH_OTP' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        logMessage('Auto fetch failed. Type OTP manually in the box.');
        return;
      }
      
      const data = response.data;
      if (data && data.success && data.otp) {
        const otpCode = data.otp;
        const otpFieldBox = document.getElementById('otp-input-field');
        if (otpFieldBox) otpFieldBox.value = otpCode;
        logMessage('Fetched OTP successfully.');
        pushManualOTP();
      }
    });
  } catch (err) {
    logMessage('OTP fetch exception occurred.');
  }
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
  dialogs: 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal, .popup, .popup-overlay, .dialog, .swal2-popup, .swal-modal, .ant-modal, .MuiDialog-root, [data-state="open"][data-dialog]',
  otp: 'input[name*="otp" i], input[placeholder*="otp" i], input[aria-label*="otp" i], input#otp, input[autocomplete="one-time-code"]',
  phone: 'input[type="tel"], input[placeholder*="01"], input[name="username"]',
  mission: 'select[name*="mission" i], select#mission, select.mission-select',
  center: 'select[name*="center" i], select#center, select.center-select',
  dates: '.calendar-day.available:not(.disabled), td.available:not(.disabled), .calendar .day.available, .p-datepicker-calendar td:not(.p-disabled) span:not(.p-disabled)',
  busy: '[aria-busy="true"], [role="progressbar"], .loading-spinner, .spinner-border, .ant-spin-spinning, [data-status="uploading"]',
  uploadOK: '[data-upload-status="success"], [data-status="uploaded"], .upload-success, .ant-upload-list-item-done',
  uploadError: '[data-upload-status="error"], [data-status="error"], .upload-error, .ant-upload-list-item-error',
  booked: '[data-booking-status="confirmed"], #booking-success, .booking-success',
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
  return el?.closest('form, [role="dialog"], dialog, .swal2-popup, .ant-modal, .MuiDialog-root, [data-step], .card') ||
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

function hasWorkflowControls(root) {
  return !!first(`${PAGE.otp}, ${PAGE.phone}, input[type="password"], ${PAGE.mission}, ${PAGE.center}`, root) ||
    fileInputs(root).length > 0 || !!first(PAGE.captcha, root);
}
function executePopupCleanup() {
  let closed = false;
  const dialogs = all(PAGE.dialogs).reverse();
  for (const dialog of dialogs) {
    // Never destroy a live OTP, CAPTCHA, document or other data-entry form.
    if (hasWorkflowControls(dialog) || first('input:not([type="hidden"]), select, textarea', dialog)) continue;
    const dismiss = all('button, a, [role="button"]', dialog).find(el =>
      /^(close|cancel|dismiss|not now|no thanks|ok|okay|got it|×|✕|x)$/i.test(label(el)) ||
      el.matches('.modal-close, .swal2-close, [data-dismiss="modal"], [data-bs-dismiss="modal"]'));
    if (dismiss && click(dismiss, 1200)) closed = true;
  }
  // Standalone close controls, but never unrelated position:absolute buttons.
  for (const el of all('.modal-close, button[aria-label="Close"], button[aria-label="Dismiss"], [data-bs-dismiss="modal"], [data-dismiss="modal"]')) {
    const host = el.closest(PAGE.dialogs);
    if (host && !hasWorkflowControls(host) && !first('input:not([type="hidden"]), select, textarea', host)) {
      if (click(el, 1200)) closed = true;
    }
  }
  stepStatus.popupsCleaned = all(PAGE.dialogs).length === 0;
  if (closed) logMessage('Dismissed a non-workflow popup.');
  return closed;
}

function fileInputs(root = document) {
  // Real upload inputs are often hidden behind labels. Exclude panel inputs,
  // disabled fields and inputs in hidden/inactive forms, not just hidden inputs.
  return Array.from(root.querySelectorAll('input[type="file"]')).filter(el =>
    !inPanel(el) && !el.disabled && !el.closest('[inert], [aria-hidden="true"]') &&
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
  add('otp', first(PAGE.otp));
  add('signIn', first('input[type="password"]') || first(PAGE.phone));
  const uploads = fileInputs();
  add('upload', uploads[0] || button(/^confirm all information is correct/i));
  add('mission', first(PAGE.mission) || first(PAGE.center));
  add('appointment', button(/^take your appointment\b/i));
  add('booking', first(PAGE.dates) || button(/^continue booking$/i));
  for (const dialog of all(PAGE.dialogs).reverse()) {
    if (!hasWorkflowControls(dialog)) {
      const next = button(/^next$/i, dialog);
      if (next) { steps.unshift({ kind: 'next', el: next, root: dialog }); break; }
    }
  }
  // A visible modal is the active page context, not the controls underneath it.
  const topDialog = all(PAGE.dialogs).at(-1);
  if (topDialog) return steps.filter(step => topDialog.contains(step.el));
  return steps;
}
function status(kind, done) {
  if (STATUS_KEY[kind]) stepStatus[STATUS_KEY[kind]] = done;
  updateStepTrackerUI();
}
function newStep(candidate) {
  status(candidate.kind, false);
  return { ...candidate, tries: 0, nextTry: 0, submitted: false, absentSince: 0, selectedDate: false };
}
function submitStep(step, el) {
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
      updateStage('OTP verification', '30%', 'Waiting for OTP acceptance, not just a button click.');
      const code = document.getElementById('otp-input-field')?.value?.trim();
      if (code && setValue(step.el, code)) { step.nextTry = Date.now() + 400; return; }
      if (!step.el.value?.trim() || !step.el.checkValidity()) return;
      submitStep(step, button(/^(verify(?: otp)?|submit|confirm(?: otp)?|verify & continue)$/i, root));
      break;
    }
    case 'appointment':
      updateStage('Take appointment', '45%', 'Waiting for the appointment page.');
      submitStep(step, step.el);
      break;
    case 'next':
      updateStage('Additional step', '45%', 'Continuing the informational popup.');
      submitStep(step, step.el);
      break;
    case 'upload':
      performUploads(step);
      break;
    case 'mission': {
      updateStage('Mission / center', '85%', 'Waiting for selection acceptance.');
      let changed = false;
      for (const [selector, id] of [[PAGE.mission, 'config-mission'], [PAGE.center, 'config-center']]) {
        const select = first(selector, root);
        if (!select) continue;
        const wanted = document.getElementById(id)?.value;
        const option = Array.from(select.options).find(o => !o.disabled && (o.value === wanted || o.textContent.trim() === wanted));
        if (!option) return; // Dependent options may still be loading.
        changed = setValue(select, option.value) || changed;
      }
      if (changed) { step.nextTry = Date.now() + 700; return; }
      submitStep(step, button(/^confirm mission(?: & ivac center)?$/i, root));
      break;
    }
    case 'booking': {
      updateStage('Book slot', '95%', 'Waiting for an explicit booking-success signal.');
      if (first(PAGE.booked)) { status('booking', true); activeStep = null; return; }
      const dates = all(PAGE.dates).filter(enabled);
      const metric = document.getElementById('metric-dates');
      if (metric) metric.innerText = dates.length;
      const proceed = button(/^continue booking$/i, root);
      if (proceed && (step.selectedDate || !dates.length)) submitStep(step, proceed);
      else if (dates.length && !step.selectedDate && click(dates.at(-1))) {
        step.selectedDate = true;
        step.nextTry = Date.now() + 1000;
      }
      // No broad "proceed" / final-confirm matching: final booking/payment remains manual.
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
function performUploads(step) {
  updateStage('Upload documents', '70%', 'Waiting for every upload to finish and be acknowledged.');
  const inputs = fileInputs(step.root);
  const files = [primarySlotKey, ...[1, 2, 3].filter(k => k != primarySlotKey)]
    .map(k => uploadedFilesMap[k]).filter(Boolean);
  if (!step.uploadState) step.uploadState = new WeakMap();
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (uploadSucceeded(input)) continue;
    const file = files[i];
    if (!file && !input.files.length) {
      updateStage('Upload documents', '70%', `Load the document for page upload ${i + 1} in the panel.`);
      return;
    }
    const local = uploadScope(input);
    if (busy(local)) return;
    const previous = step.uploadState.get(input) || 0;
    const failed = !!first(PAGE.uploadError, local);
    // Do not replace selected files repeatedly while an uninstrumented upload
    // may still be in flight. Retry only explicit errors, or an empty input.
    if ((!input.files.length || failed) && file && Date.now() - previous >= 5000) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      step.uploadState.set(input, Date.now());
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      step.nextTry = Date.now() + 1000;
      logMessage(`Document ${i + 1} attached; waiting for server confirmation.`);
      return;
    }
    // Some sites require Upload before displaying the verified check mark.
    submitStep(step, button(/^upload(?: file| document| all files| documents)?$/i, local) ||
      button(/^upload(?: file| document| all files| documents)?$/i, step.root));
    return;
  }
  // No success is inferred from input.files or from clicking Upload.
  if (inputs.length && !inputs.every(uploadSucceeded)) return;
  const confirm = button(/^confirm all information is correct$/i, step.root);
  if (confirm) submitStep(step, confirm);
  // Stay locked here until the confirmed upload screen actually transitions.
}
function runManualStep(kind) {
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
    const metric = document.getElementById('metric-attempts');
    if (metric) metric.innerText = ++attemptCount;
    // Cleaner runs on EVERY scan, even while another step is pending.
    if (executePopupCleanup()) return true;
    const candidates = detectSteps();
    // An informational Next popup may interrupt a pending request. Continue it
    // without abandoning the original step or declaring that step successful.
    const nextPopup = candidates.find(s => s.kind === 'next');
    if (nextPopup && activeStep && activeStep.kind !== 'next') {
      if (!popupContinuation || popupContinuation.el !== nextPopup.el) popupContinuation = newStep(nextPopup);
      performStep(popupContinuation);
      activeStep.absentSince = 0;
      return true;
    }
    popupContinuation = null;
    if (activeStep) {
      const current = candidates.find(s => s.kind === activeStep.kind);
      if (current) {
        activeStep.el = current.el;
        activeStep.root = current.root;
        activeStep.absentSince = 0;
      } else {
        const other = candidates.find(s => s.kind !== activeStep.kind);
        const blocked = all(PAGE.dialogs).length > 0 || busy() || captchaPending();
        if (activeStep.kind === 'booking' && first(PAGE.booked)) {
          status('booking', true);
          activeStep = null;
          return true;
        }
        // A transiently missing input is NOT success. Require an actual submitted
        // action, another recognized step, no blockers, and a stable transition.
        if (activeStep.submitted && other && !blocked) {
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
    scheduleWorkflow();
  }
}

// Reopen the panel from Chrome's toolbar without resetting the active page.
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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