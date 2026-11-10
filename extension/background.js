// Chrome Manifest V3 worker. Workflow and controls live in content.js.
const APPOINTMENT_URL = 'https://appointment.ivacbd.com/';
const OTP_URL = 'http://192.168.0.100:5000/get-latest-otp?consume=1';
let otpRequestPending = false;
let otpController = null;

chrome.action.onClicked.addListener(async tab => {
  try {
    if (!tab.id || new URL(tab.url || 'about:blank').origin !== new URL(APPOINTMENT_URL).origin) {
      await chrome.tabs.create({ url: APPOINTMENT_URL });
      return;
    }
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_AUTOMATOR_PANEL' });
      await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
      await chrome.action.setTitle({ tabId: tab.id, title: 'Open Visa Automator Pro' });
    } catch {
      // Never reload an applicant's live form without their consent.
      await chrome.action.setBadgeText({ tabId: tab.id, text: '↻' });
      await chrome.action.setTitle({
        tabId: tab.id,
        title: 'Refresh this appointment tab once to activate Visa Automator Pro'
      });
    }
  } catch (error) {
    console.error('Unable to open automator panel:', error.message);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['FETCH_OTP', 'RESET_AUTOMATOR'].includes(message?.type)) return false;
  if (!sender.tab?.url?.startsWith(APPOINTMENT_URL)) {
    sendResponse({ ok: false, error: 'OTP requests are only allowed from the appointment page.' });
    return false;
  }
  if (message.type === 'RESET_AUTOMATOR') {
    (async () => {
      try {
        otpController?.abort();
        const tabs = await chrome.tabs.query({ url: `${APPOINTMENT_URL}*` });
        await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'RESET_AUTOMATOR_STATE' }).catch(() => {})));
        // Last operation: leave storage truly empty, without writing defaults back.
        await chrome.storage.local.clear();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }
  if (otpRequestPending) {
    sendResponse({ ok: false, error: 'An OTP request is already running.' });
    return false;
  }
  otpRequestPending = true;
  otpController = new AbortController();
  (async () => {
    try {
      const timeout = setTimeout(() => otpController?.abort(), 12000);
      let response;
      try {
        response = await fetch(OTP_URL, { signal: otpController.signal, cache: 'no-store' });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`OTP service returned HTTP ${response.status}`);
      const data = await response.json();
      if (!data || typeof data !== 'object') throw new Error('Invalid OTP service response');
      sendResponse({ ok: true, data });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    } finally {
      otpRequestPending = false;
      otpController = null;
    }
  })();
  return true;
});
