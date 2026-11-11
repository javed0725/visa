// Chrome Manifest V3 worker. Workflow and controls live in content.js.
const APPOINTMENT_URL = 'https://appointment.ivacbd.com/';
importScripts('phone-relay.js');
let otpRequest = null;
let resetting = false;

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
  const phoneActions = ['PHONE_STATE', 'PHONE_ENABLE', 'PHONE_REGENERATE', 'PHONE_CONFIGURE', 'PHONE_SETUP', 'PHONE_ACK_OTP'];
  if (!['FETCH_OTP', 'RESET_AUTOMATOR', ...phoneActions].includes(message?.type)) return false;
  const fromOptions = sender.url === chrome.runtime.getURL('options.html') && !sender.tab?.url?.startsWith(APPOINTMENT_URL);
  if (!sender.tab?.url?.startsWith(APPOINTMENT_URL) && !fromOptions) {
    sendResponse({ ok: false, error: 'OTP requests are only allowed from the appointment page.' });
    return false;
  }
  if (resetting) {
    sendResponse({ ok: false, error: 'Reset in progress. Please wait.' });
    return false;
  }
  if (phoneActions.includes(message.type)) {
    if (message.type === 'PHONE_CONFIGURE' && !fromOptions) {
      sendResponse({ ok: false, error: 'Relay configuration is only allowed from extension settings.' });
      return false;
    }
    (async () => {
      try {
        let state;
        if (message.type === 'PHONE_SETUP') await chrome.runtime.openOptionsPage();
        else if (message.type === 'PHONE_STATE') state = await PhoneRelay.state();
        else state = await PhoneRelay.serial(() =>
          message.type === 'PHONE_ACK_OTP' ? PhoneRelay.ack(message.messageId) :
          message.type === 'PHONE_CONFIGURE' ? PhoneRelay.configure(message.relayURL) :
          message.type === 'PHONE_REGENERATE' ? PhoneRelay.regenerate() :
          PhoneRelay.enable(message.enabled === true));
        sendResponse({ ok: true, state });
      } catch (error) { sendResponse({ ok: false, error: error.message }); }
    })();
    return true;
  }
  if (message.type === 'RESET_AUTOMATOR') {
    resetting = true;
    (async () => {
      try {
        await PhoneRelay.serial(async () => {
          let warning;
          try { await PhoneRelay.reset(); }
          catch { warning = 'Local data cleared, but the relay could not be reached to unpair. Unpair in the Android app too.'; }
          const tabs = await chrome.tabs.query({ url: `${APPOINTMENT_URL}*` });
          await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'RESET_AUTOMATOR_STATE' }).catch(() => {})));
          // Last queued operation: old receipts cannot restore cleared credentials.
          await chrome.storage.local.clear();
          sendResponse({ ok: true, warning });
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      } finally { resetting = false; }
    })();
    return true;
  }
  if (fromOptions || !sender.tab?.active) {
    sendResponse({ ok: false, error: 'Keep the IVAC OTP tab active to receive a code.' });
    return false;
  }
  // Share an in-flight read rather than turning simultaneous panel/automatic
  // reads into errors that trigger the content script's long error backoff.
  if (!otpRequest) {
    otpRequest = PhoneRelay.fetchOTP()
      .then(data => ({ ok: true, data }), error => ({ ok: false, error: error.message }))
      .finally(() => { otpRequest = null; });
  }
  otpRequest.then(sendResponse);
  return true;
});
