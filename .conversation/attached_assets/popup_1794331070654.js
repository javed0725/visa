// popup.js — side panel controller
const $ = (id) => document.getElementById(id);
const MAX_DOC_BYTES = 5 * 1024 * 1024;

const send = (message) => chrome.runtime.sendMessage(message);

async function run(btn, message, okText) {
  btn.disabled = true;
  try {
    const res = await send(message);
    if (!res || !res.ok) appendLocalLog('error', (res && res.error) || 'No response');
    else if (okText) appendLocalLog('info', okText);
    if (res && res.stage) $('stagePill').textContent = `Stage: ${res.stage}`;
    if (res && res.dates) appendLocalLog('info', `Dates found: ${res.dates.length}`);
    await refresh();
    return res;
  } finally { btn.disabled = false; }
}

function appendLocalLog(level, msg) {
  const d = document.createElement('div');
  d.className = level;
  d.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  $('log').prepend(d);
}

// ---------- Rendering ----------
async function refresh() {
  const snap = await send({ type: 'GET_SNAPSHOT' });
  if (!snap || !snap.ok) return;

  $('statePill').textContent = snap.wfState;
  $('statePill').dataset.state = snap.wfState;
  $('chkPolling').checked = snap.polling;
  $('tokenInfo').textContent = snap.token
    ? `Token …${snap.token.value.slice(-6)} (${new Date(snap.token.savedAt).toLocaleTimeString()})`
    : 'Token: none';

  const c = snap.config;
  if (document.activeElement.id !== 'cfgUser') $('cfgUser').value = c.credentials.username || '';
  if (document.activeElement.id !== 'cfgPass') $('cfgPass').value = c.credentials.password || '';
  $('cfgPoll').value = c.pollMinutes;
  $('cfgAutoBook').checked = !!c.autoBook;
  $('cfgAutoConfirm').checked = !!c.autoConfirm;
  if (!$('cfgJson').matches(':focus')) {
    $('cfgJson').value = JSON.stringify({ selectors: c.selectors, stages: c.stages, tokenSource: c.tokenSource }, null, 2);
  }

  $('docList').innerHTML = '';
  snap.docs.forEach(d => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${d.name} (${(d.size / 1024).toFixed(0)} KB)`;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.onclick = () => removeDoc(d.id);
    li.append(name, del);
    $('docList').appendChild(li);
  });

  $('log').innerHTML = '';
  snap.logs.slice().reverse().forEach(l => {
    const d = document.createElement('div');
    d.className = l.level;
    d.textContent = `${new Date(l.t).toLocaleTimeString()}  ${l.msg}`;
    $('log').appendChild(d);
  });
}

// ---------- Documents ----------
const fileToB64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result.split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

async function addDocs(files) {
  const { docs = [] } = await chrome.storage.local.get('docs');
  for (const f of files) {
    if (f.type !== 'application/pdf') { appendLocalLog('warn', `${f.name}: not a PDF`); continue; }
    if (f.size > MAX_DOC_BYTES) { appendLocalLog('warn', `${f.name}: over 5 MB`); continue; }
    docs.push({ id: crypto.randomUUID(), name: f.name, size: f.size, type: f.type, b64: await fileToB64(f) });
  }
  await chrome.storage.local.set({ docs });
  await refresh();
}

async function removeDoc(id) {
  const { docs = [] } = await chrome.storage.local.get('docs');
  await chrome.storage.local.set({ docs: docs.filter(d => d.id !== id) });
  await refresh();
}

// ---------- Settings ----------
async function saveSettings() {
  const snap = await send({ type: 'GET_SNAPSHOT' });
  let extra;
  try { extra = JSON.parse($('cfgJson').value); }
  catch { return appendLocalLog('error', 'Selectors JSON is invalid.'); }

  const config = {
    ...snap.config,
    credentials: { username: $('cfgUser').value.trim(), password: $('cfgPass').value },
    pollMinutes: Math.max(0.5, Number($('cfgPoll').value) || 1),
    autoBook: $('cfgAutoBook').checked,
    autoConfirm: $('cfgAutoConfirm').checked,
    selectors: extra.selectors || snap.config.selectors,
    stages: extra.stages || snap.config.stages,
    tokenSource: extra.tokenSource || snap.config.tokenSource
  };
  await send({ type: 'SAVE_CONFIG', config });
  appendLocalLog('info', 'Settings saved.');
  await refresh();
}

// ---------- Wiring ----------
$('btnSignIn').onclick = (e) => run(e.target, { type: 'SIGN_IN' }, 'Sign-in submitted.');
$('btnOtp').onclick    = (e) => run(e.target, { type: 'OTP_VERIFY', code: $('otpInput').value.trim() }, 'OTP submitted.');
$('btnStage').onclick  = (e) => run(e.target, { type: 'DETECT_STAGE' });
$('btnScan').onclick   = (e) => run(e.target, { type: 'SCAN_DATES' });
$('btnToken').onclick  = (e) => run(e.target, { type: 'FRESH_TOKEN' }, 'Token refreshed.');
$('btnAttach').onclick = (e) => run(e.target, { type: 'ATTACH_DOCS' });
$('btnSave').onclick   = saveSettings;
$('chkPolling').onchange = (e) => send({ type: e.target.checked ? 'START_POLLING' : 'STOP_POLLING' }).then(refresh);
$('fileInput').onchange = (e) => addDocs(Array.from(e.target.files)).then(() => (e.target.value = ''));
document.querySelector('.drop').onclick = () => $('fileInput').click();

chrome.runtime.onMessage.addListener((m) => {
  if (m.type === 'STATE_CHANGED' || m.type === 'LOG_UPDATED') refresh();
});

refresh();
