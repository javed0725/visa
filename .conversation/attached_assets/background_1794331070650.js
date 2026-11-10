// background.js — MV3 service worker
// Responsibilities: seed config, session token store, polling alarms, message routing.

const ALARM_NAME = 'poll-dates';

const DEFAULT_CONFIG = {
  credentials: { username: '', password: '' },
  pollMinutes: 1,            // Chrome minimum for alarms is 0.5
  autoBook: false,           // click first available date automatically
  autoConfirm: false,        // click the FINAL confirm button automatically (keep false unless you are sure)
  tokenSource: {
    storage: 'localStorage', // 'localStorage' | 'sessionStorage'
    key: 'access_token',
    refreshUrl: '',          // optional: endpoint that returns a fresh token
    method: 'POST',
    tokenField: 'access_token'
  },
  stages: [                  // first match wins, so list most specific first
    { name: 'CONFIRM',   selector: '#confirm-booking' },
    { name: 'CALENDAR',  selector: '.calendar' },
    { name: 'OTP',       selector: 'input#otp' },
    { name: 'LOGIN',     selector: 'input[type="password"]' },
    { name: 'DASHBOARD', selector: '.dashboard' }
  ],
  selectors: {
    username: 'input[name="username"]',
    password: 'input[type="password"]',
    loginSubmit: 'button[type="submit"]',
    otpInput: 'input#otp',
    otpSubmit: 'button#verify-otp',
    searchButton: '',
    availableDate: '.calendar .day.available',
    timeSlot: '.slot.available',
    fileInput: 'input[type="file"]',
    confirmButton: '#confirm-booking'
  }
};

// ---------- Helpers ----------
const store = {
  get: async (k) => (await chrome.storage.local.get(k))[k],
  set: (k, v) => chrome.storage.local.set({ [k]: v })
};

async function getConfig() {
  const saved = await store.get('config');
  return { ...DEFAULT_CONFIG, ...(saved || {}),
    selectors: { ...DEFAULT_CONFIG.selectors, ...((saved || {}).selectors || {}) },
    tokenSource: { ...DEFAULT_CONFIG.tokenSource, ...((saved || {}).tokenSource || {}) } };
}

async function log(level, msg) {
  const logs = (await store.get('logs')) || [];
  logs.push({ t: Date.now(), level, msg });
  await store.set('logs', logs.slice(-100));
  chrome.runtime.sendMessage({ type: 'LOG_UPDATED' }).catch(() => {});
}

async function findTargetTab() {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const patterns = chrome.runtime.getManifest().host_permissions;
  const matches = await chrome.tabs.query({ url: patterns });
  if (active && matches.some(t => t.id === active.id)) return active;
  return matches[0] || null;
}

async function sendToContent(message) {
  const tab = await findTargetTab();
  if (!tab) throw new Error('No tab open on the target domain.');
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (e) {
    // Content script not present yet (e.g. tab opened before install) — inject and retry.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    return await chrome.tabs.sendMessage(tab.id, message);
  }
}

// ---------- Token management ----------
async function freshToken() {
  const cfg = await getConfig();
  const src = cfg.tokenSource;
  let token = null;

  if (src.refreshUrl) {
    const res = await fetch(src.refreshUrl, { method: src.method, credentials: 'include' });
    if (!res.ok) throw new Error(`Token endpoint returned ${res.status}`);
    const json = await res.json();
    token = json[src.tokenField];
  } else {
    const r = await sendToContent({ type: 'CS_READ_TOKEN', source: src });
    token = r && r.token;
  }
  if (!token) throw new Error('No token found. Check tokenSource settings.');

  const record = { value: token, savedAt: Date.now() };
  await store.set('token', record);
  await log('info', 'Session token refreshed.');
  return record;
}

// ---------- Polling ----------
async function startPolling() {
  const cfg = await getConfig();
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: Math.max(0.5, Number(cfg.pollMinutes) || 1) });
  await store.set('polling', true);
  await log('info', `Polling started (every ${cfg.pollMinutes} min).`);
}

async function stopPolling() {
  await chrome.alarms.clear(ALARM_NAME);
  await store.set('polling', false);
  await log('info', 'Polling stopped.');
}

async function pollOnce() {
  try {
    const result = await sendToContent({ type: 'CS_SCAN_DATES' });
    await store.set('lastScan', { at: Date.now(), ...result });
    if (result && result.ok && result.dates && result.dates.length) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Dates available',
        message: `${result.dates.length} date(s) found. Open the tab to continue.`,
        priority: 2
      });
    }
  } catch (e) {
    await log('error', `Poll failed: ${e.message}`);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) pollOnce();
});

// ---------- Lifecycle ----------
chrome.runtime.onInstalled.addListener(async () => {
  if (!(await store.get('config'))) await store.set('config', DEFAULT_CONFIG);
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// ---------- Message router ----------
const UI_TO_CONTENT = {
  SIGN_IN: 'CS_SIGN_IN',
  OTP_VERIFY: 'CS_OTP_VERIFY',
  DETECT_STAGE: 'CS_DETECT_STAGE',
  SCAN_DATES: 'CS_SCAN_DATES',
  BOOK: 'CS_BOOK',
  ATTACH_DOCS: 'CS_ATTACH_DOCS'
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (UI_TO_CONTENT[msg.type]) {
        const res = await sendToContent({ ...msg, type: UI_TO_CONTENT[msg.type] });
        return sendResponse(res);
      }
      switch (msg.type) {
        case 'FETCH_OTP': {
          try {
           const res = await fetch('http://192.168.0.100:5000/get-latest-otp?consume=1');
            const data = await res.json();
            return sendResponse({ ok: true, data });
          } catch (err) {
            return sendResponse({ ok: false, error: err.toString() });
          }
        }
        case 'FRESH_TOKEN':   return sendResponse({ ok: true, token: await freshToken() });
        case 'START_POLLING': await startPolling(); return sendResponse({ ok: true });
        case 'STOP_POLLING':  await stopPolling();  return sendResponse({ ok: true });
        case 'GET_SNAPSHOT': {
          const [config, token, polling, logs, lastScan, wfState, docs] = await Promise.all([
            getConfig(), store.get('token'), store.get('polling'), store.get('logs'),
            store.get('lastScan'), store.get('wfState'), store.get('docs')
          ]);
          return sendResponse({ ok: true, config, token, polling: !!polling, logs: logs || [],
            lastScan, wfState: wfState || 'IDLE', docs: docs || [] });
        }
        case 'SAVE_CONFIG':
          await store.set('config', msg.config);
          if (await store.get('polling')) await startPolling(); // apply new interval
          return sendResponse({ ok: true });
        case 'LOG': await log(msg.level, msg.message); return sendResponse({ ok: true });
        default: return sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (e) {
      await log('error', e.message);
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // keep channel open for async response
});