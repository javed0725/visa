// Visa Automator Pro (v15.11) - Multi-Slot Primary & Secondary Webfile Upload Logic with "Take Your Appointment" Step Integration
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

  chrome.storage.local.get(['panelPos', 'savedPhone', 'savedPass', 'primarySlot', 'savedMission', 'savedCenter', 'savedFilesMap'], async (result) => {
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
    logBox.innerHTML += `<div>> ${msg}</div>`;
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
  logMessage('Full multi-step automation active with Take Appointment step...');

  if (automatorInterval) clearInterval(automatorInterval);
  automatorInterval = setInterval(() => {
    executeWorkflowSteps();
  }, 1500);
}

function stopAutomation() {
  isRunning = false;
  if (automatorInterval) clearInterval(automatorInterval);
  logMessage('Automation stopped.');
}

function pushManualOTP() {
  const otpFieldBox = document.getElementById('otp-input-field');
  const otpCode = otpFieldBox ? otpFieldBox.value.trim() : '';

  if (!otpCode) {
    logMessage('Error: Please type or fetch OTP code first in the panel input.');
    return;
  }

  const otpInput = document.querySelector('input[name*="otp"], input[placeholder*="OTP"], input[aria-label*="OTP"], input#otp');
  if (otpInput) {
    otpInput.value = otpCode;
    otpInput.dispatchEvent(new Event('input', { bubbles: true }));
    otpInput.dispatchEvent(new Event('change', { bubbles: true }));
    logMessage(`Applied OTP manually from panel: ${otpCode}`);

    setTimeout(() => {
      const verifyBtn = Array.from(document.querySelectorAll('button')).find(b => 
        b.textContent.toLowerCase().includes('verify') || b.textContent.toLowerCase().includes('submit') || b.textContent.toLowerCase().includes('confirm')
      );
      if (verifyBtn) {
        verifyBtn.click();
        logMessage('Clicked OTP Verify / Submit button successfully!');
        stepStatus.otpVerified = true;
        updateStepTrackerUI();
      }
    }, 500);
  } else {
    logMessage('Warning: OTP input field not found on webpage currently.');
  }
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
        logMessage(`Fetched OTP successfully: ${otpCode}`);
        pushManualOTP();
      }
    });
  } catch (err) {
    logMessage('OTP fetch exception occurred.');
  }
}

// Individual Modular Step Functions
function executeSignInStep() {
  const phoneVal = document.getElementById('phone-field').value;
  const passVal = document.getElementById('pass-field').value;
  const phoneInput = document.querySelector('input[type="tel"], input[placeholder*="01"]');
  const passInput = document.querySelector('input[type="password"]');
  const signInBtn = Array.from(document.querySelectorAll('button')).find(b => 
    b.textContent.includes('Sign In Now') || b.textContent.includes('Sign In')
  );

  if (phoneInput && passInput && phoneVal) {
    updateStage('Sign in', '15%', 'Filling phone and password...');
    phoneInput.value = phoneVal;
    phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
    passInput.value = passVal;
    passInput.dispatchEvent(new Event('change', { bubbles: true }));
    if (signInBtn) setTimeout(() => signInBtn.click(), 400);
    stepStatus.signIn = true;
    updateStepTrackerUI();
    return true;
  }
  return false;
}

function executePopupCleanup() {
  const closeBtns = document.querySelectorAll('div[role="dialog"] button, button.absolute, .modal-close, button[aria-label="Close"]');
  if (closeBtns.length > 0) {
    closeBtns.forEach(btn => {
      if (btn.offsetParent !== null && !btn.textContent.includes('Save')) btn.click();
    });
    updateStage('Popups Cleaned', '45%', 'Closed active pop-up modals.');
    stepStatus.popupsCleaned = true;
    updateStepTrackerUI();
    return true;
  }
  return false;
}

function executeTakeAppointmentStep() {
  const takeAppBtn = Array.from(document.querySelectorAll('button, a, div')).find(el => 
    el.textContent && el.textContent.toLowerCase().includes('take your appointment') && el.offsetParent !== null
  );

  if (takeAppBtn) {
    updateStage('Take Appointment', '60%', 'Clicking Take Your Appointment...');
    takeAppBtn.click();
    logMessage('Clicked "Take Your Appointment" successfully!');
    stepStatus.takeAppointmentClicked = true;
    updateStepTrackerUI();
    return true;
  }
  return false;
}

function executeFileUploadLogic() {
  const pageFileInputs = document.querySelectorAll('input[type="file"]');
  if (pageFileInputs.length > 0) {
    let orderedFiles = [];
    if (uploadedFilesMap[primarySlotKey]) {
      orderedFiles.push(uploadedFilesMap[primarySlotKey]);
    }
    [1, 2, 3].forEach(k => {
      if (k != primarySlotKey && uploadedFilesMap[k]) {
        orderedFiles.push(uploadedFilesMap[k]);
      }
    });

    pageFileInputs.forEach((pageInput, idx) => {
      if (orderedFiles[idx] && !pageInput.files.length) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(orderedFiles[idx]);
        pageInput.files = dataTransfer.files;
        pageInput.dispatchEvent(new Event('change', { bubbles: true }));
        logMessage(`Uploaded file (${idx === 0 ? 'Primary' : 'Secondary'}): ${orderedFiles[idx].name}`);
      }
    });

    const confirmInfoBtn = Array.from(document.querySelectorAll('button')).find(b => 
      b.textContent.toLowerCase().includes('confirm all information is correct') || b.textContent.toLowerCase().includes('upload')
    );
    if (confirmInfoBtn && confirmInfoBtn.offsetParent !== null) {
      updateStage('Upload all files', '75%', 'Confirming webfile information...');
      confirmInfoBtn.click();
    }

    stepStatus.filesUploaded = true;
    updateStepTrackerUI();
    return true;
  }
  return false;
}

function executeMissionSelection() {
  const missionSelect = document.querySelector('select[name*="mission"], select#mission, .mission-select');
  const centerSelect = document.querySelector('select[name*="center"], select#center, .center-select');
  const confirmMissionBtn = Array.from(document.querySelectorAll('button')).find(b => 
    b.textContent.toLowerCase().includes('confirm mission & ivac center') || b.textContent.toLowerCase().includes('confirm mission')
  );

  if ((missionSelect || centerSelect) && confirmMissionBtn && confirmMissionBtn.offsetParent !== null) {
    updateStage('Mission / Center', '85%', 'Selecting mission and IVAC center...');
    
    chrome.storage.local.get(['savedMission', 'savedCenter'], (res) => {
      if (missionSelect && res.savedMission) {
        missionSelect.value = res.savedMission;
        missionSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (centerSelect && res.savedCenter) {
        centerSelect.value = res.savedCenter;
        centerSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    setTimeout(() => confirmMissionBtn.click(), 500);
    stepStatus.missionSelected = true;
    updateStepTrackerUI();
    return true;
  }
  return false;
}

let lastSlotTryTime = 0;
function executeSlotBooking() {
  const dateCells = Array.from(document.querySelectorAll('.calendar-day:not(.disabled), td.available:not(.disabled), td:not(.disabled):not(.muted), .p-datepicker-calendar td span:not(.p-disabled)'))
    .filter(el => el.textContent.trim() !== '' && !el.classList.contains('disabled') && !el.classList.contains('p-disabled'));

  if (dateCells.length > 0) {
    updateStage('Book slot', '95%', `Found ${dateCells.length} available dates!`);
    const dateCountElem = document.getElementById('metric-dates');
    if (dateCountElem) dateCountElem.innerText = dateCells.length;

    const now = Date.now();
    if (now - lastSlotTryTime > 20000 || isRunning) {
      lastSlotTryTime = now;
      logMessage(`Trying reverse date slot selection...`);
      
      const reverseDates = dateCells.reverse();
      reverseDates[0].click();

      setTimeout(() => {
        const continueBookingBtn = Array.from(document.querySelectorAll('button, a')).find(b => 
          b.textContent.toLowerCase().includes('continue booking') || b.textContent.toLowerCase().includes('proceed')
        );
        if (continueBookingBtn) {
          continueBookingBtn.click();
          logMessage('Clicked Continue Booking successfully!');
          stepStatus.slotBooked = true;
          updateStepTrackerUI();
        }
      }, 600);
    }
    return true;
  }
  return false;
}

// Main Workflow Automation Handler (Strict Sequential Order)
let attemptCount = 0;
function executeWorkflowSteps() {
  attemptCount++;
  const attElem = document.getElementById('metric-attempts');
  if (attElem) attElem.innerText = attemptCount;

  // 1. Sign In Check
  const phoneInput = document.querySelector('input[type="tel"], input[placeholder*="01"]');
  if (phoneInput && phoneInput.value === '') {
    executeSignInStep();
    return;
  } else {
    stepStatus.signIn = true;
  }

  // 2. OTP Check
  const otpField = document.querySelector('input[name*="otp"], input[placeholder*="OTP"], input[aria-label*="OTP"], input#otp');
  if (otpField && otpField.offsetParent !== null && !stepStatus.otpVerified) {
    updateStage('OTP Verification', '30%', 'Waiting for OTP verification...');
    return;
  } else if (otpField === null && stepStatus.signIn) {
    stepStatus.otpVerified = true;
  }

  // 3. Popups Cleanup
  if (executePopupCleanup()) return;
  else stepStatus.popupsCleaned = true;

  // 4. Take Your Appointment Button Click
  if (executeTakeAppointmentStep()) return;
  else stepStatus.takeAppointmentClicked = true;

  // 5. Webfiles Upload
  if (executeFileUploadLogic()) return;
  else stepStatus.filesUploaded = true;

  // 6. Mission & Center Selection
  if (executeMissionSelection()) return;
  else stepStatus.missionSelected = true;

  // 7. Slot Booking
  executeSlotBooking();
  updateStepTrackerUI();
}

// Auto-inject when target domain loads
if (window.location.href.includes('appointment.ivacbd.com')) {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', createFloatingPanel);
  } else {
    createFloatingPanel();
  }
}