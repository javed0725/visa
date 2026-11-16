// Runs only in the trusted extension service worker. Never returns bearer tokens to the page.
const PhoneRelay = (() => {
  let epoch = 0;
  let chain = Promise.resolve();
  const serial = work => {
    const task = chain.then(work);
    chain = task.catch(() => {});
    return task;
  };
  const load = async () => (await chrome.storage.local.get('phoneOTP')).phoneOTP || {};
  const save = async config => { await chrome.storage.local.set({ phoneOTP: config }); return config; };
  const publicState = config => ({
    relayURL: config.relayURL || '', enabled: !!config.enabled,
    clientKey: config.clientKey || '', paired: !!config.paired,
    pairExpiresAt: config.pairExpiresAt || 0, expiresAt: config.expiresAt || 0
  });
  function origin(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) throw Error('Enter an HTTPS relay origin, without a path, query or password.');
    return url.origin;
  }
  async function request(config, path, method = 'GET', body, authenticated = true, timeoutMs = 10000) {
    if (!config.relayURL) throw Error('Open Relay setup first.');
    if (!await chrome.permissions.contains({ origins: [`${config.relayURL}/*`] }))
      throw Error('Relay permission is missing. Open Relay setup and save again.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${config.relayURL}/api/phone-otp${path}`, {
        method, headers: {
          'Content-Type': 'application/json',
          ...(authenticated ? { Authorization: `Bearer ${config.browserToken}` } : {})
        }, body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', redirect: 'error', credentials: 'omit', signal: controller.signal
      });
      const data = response.status === 204 ? {} : await response.json();
      if (!response.ok) {
        const error = new Error(data.error || `Relay returned HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return data;
    } finally { clearTimeout(timeout); }
  }
  async function revoke(config) {
    if (!config.browserToken) return;
    try { await request(config, '/pairing', 'DELETE'); }
    catch (error) { if (error.status !== 401) throw error; }
  }
  async function create(relayURL, enabled) {
    const config = { relayURL, enabled };
    const credentials = await request(config, '/pairings', 'POST', undefined, false);
    Object.assign(config, credentials, { paired: false });
    // Save credentials before the preference update so a failed request can be retried.
    await save(config);
    if (!enabled) await request(config, '/pairing', 'PATCH', { enabled: false });
    return config;
  }
  return {
    serial, origin,
    async state() {
      const config = await load();
      if (config.browserToken) {
        const state = await request(config, '/pairing');
        return { ...publicState(config), ...state, enabled: !!config.enabled && !!state.enabled };
      }
      return publicState(config);
    },
    async configure(value) {
      const relayURL = origin(value);
      if (!await chrome.permissions.contains({ origins: [`${relayURL}/*`] })) throw Error('Grant access to this relay first.');
      epoch++;
      const old = await load();
      await revoke(old);
      await save({ relayURL, enabled: false });
      return publicState(await create(relayURL, false));
    },
    async regenerate() {
      epoch++;
      const config = await load();
      if (!config.relayURL) throw Error('Open Relay setup first.');
      await revoke(config);
      await save({ relayURL: config.relayURL, enabled: false });
      return publicState(await create(config.relayURL, !!config.enabled));
    },
    async enable(enabled) {
      epoch++;
      const config = await load();
      if (!config.browserToken) throw Error('Open Relay setup first.');
      await request(config, '/pairing', 'PATCH', { enabled });
      config.enabled = enabled;
      await save(config);
      return { ...publicState(config), ...await request(config, '/pairing') };
    },
    async fetchOTP() {
      const version = epoch;
      const config = await load();
      if (!config.enabled) return { success: false };
      if (!config.browserToken) throw Error('Pair your phone using Relay setup.');
      const data = await request(config, '/messages');
      if (version !== epoch) return { success: false };
      if (data.messageId && config.consumedIds?.includes(data.messageId)) return { success: false };
      return data;
    },
    async waitOTP() {
      const version = epoch;
      const config = await load();
      if (!config.enabled) return { success: false };
      if (!config.browserToken) throw Error('Pair your phone using Relay setup.');
      let after = config.consumedIds?.[0] || '';
      for (let attempt = 0; attempt < 20; attempt++) {
        const cursor = after ? `?after=${encodeURIComponent(after)}` : '';
        const data = await request(config, `/messages/wait${cursor}`, 'GET', undefined, true, 25000);
        if (version !== epoch) return { success: false };
        if (data.messageId && config.consumedIds?.includes(data.messageId)) {
          after = data.messageId;
          continue;
        }
        return data;
      }
      return { success: false };
    },
    async ack(messageId) {
      if (!/^[0-9a-f-]{36}$/i.test(messageId || '')) throw Error('Invalid message receipt.');
      const config = await load();
      if (!config.browserToken) return;
      config.consumedIds = [...new Set([messageId, ...(config.consumedIds || [])])].slice(0, 20);
      await save(config);
    },
    async reset() {
      epoch++;
      const config = await load();
      await revoke(config);
    }
  };
})();
