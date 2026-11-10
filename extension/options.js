const status = document.getElementById('status');
chrome.runtime.sendMessage({ type: 'PHONE_STATE' }, response => {
  if (response?.state?.relayURL) document.getElementById('relay-url').value = response.state.relayURL;
  status.textContent = response?.error || 'Enter your published relay address to begin.';
});
document.getElementById('relay-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter || document.querySelector('button[type="submit"]');
  try {
    const url = new URL(document.getElementById('relay-url').value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw Error('Use only an HTTPS origin, such as https://your-relay.example');
    // Must be invoked directly from this trusted page's user gesture.
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) throw Error('Relay access was not granted.');
    button.disabled = true;
    status.textContent = 'Connecting securely…';
    const response = await chrome.runtime.sendMessage({ type: 'PHONE_CONFIGURE', relayURL: url.origin });
    if (!response?.ok) throw Error(response?.error || 'Setup failed');
    status.textContent = `Ready. Client Key: ${response.state.clientKey}\nEnable Phone OTP auto-fill in the IVAC panel, then pair the Android app.`;
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
