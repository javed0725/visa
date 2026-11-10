# Visa Automator Pro — Chrome extension

## Install

1. Download **visa-automator-pro-chrome.zip** and extract it fully. Do not select
   the ZIP itself or load the entire Replit project.
2. Open `chrome://extensions` in desktop Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted folder that directly contains **manifest.json**,
   **background.js** and **content.js**.
6. Visit `https://appointment.ivacbd.com/`. Refresh an already-open appointment
   tab once after installation or reloading the extension.
7. The floating panel appears on the appointment page. Enter credentials, load
   documents and press **Start**. **Stop** cancels observation and scheduled retries.

This download is a complete Manifest V3 Chrome extension. It does not require
the original extension folder, a build command, Node.js or a running Replit app.
No missing icon, popup or side-panel files are referenced.

Click the extension's Chrome toolbar icon to reopen a closed floating panel.
From another website, the icon opens the appointment site in a new tab. If the
toolbar icon shows a refresh indicator, refresh the appointment tab once.

## Fixing “Manifest file is missing or unreadable”

This error occurs when Chrome cannot find a readable `manifest.json` at the
top level of the selected folder. The earlier download was a content-script
update, not a complete extension. Use this complete ZIP instead.

The folder you select should look like:

```text
manifest.json
background.js
content.js
README.md
```

If you downloaded the Replit project source rather than this ZIP, select its
**extension** subfolder, not the project root.

## OTP service

Manual OTP entry works without any additional server. The optional Fetch OTP
button uses your original local service at `http://192.168.0.100:5000/`.
That service must be running and reachable from the computer running Chrome.
Chrome may ask for local-network access; grant it only if you use that service.
If automatic fetching fails, type the OTP manually in the panel.

## Changes

- The panel is 320px wide (previously 390px). Fonts, button labels, padding and
  spacing are scaled down together; the content scrolls on short screens.
- A single live workflow status replaces all step lists. It shows the detected
  action, a working spinner, and waiting/verification details. Stopping removes
  the spinner; the next detected action replaces the previous status.
- Header **RESET** stops automation and, after confirmation, erases all extension
  local storage, clears credentials/OTP, selected documents, primary selection,
  mission/center selections and progress. Other open appointment tabs also reset.
- Reset cancels in-flight OTP fetching and prevents old file readers or OTP
  responses from restoring deleted inputs. No saved defaults are written back.
- Reset does not erase the visa website's cookies/storage or undo server uploads.

- Starts from the currently detected page: sign-in, OTP, document upload,
  mission/center, appointment button, informational Next popup, or available dates.
- Watches DOM changes and also checks periodically for changes that do not
  generate DOM mutations.
- Keeps one pending workflow action; retries use a 3–20 second backoff.
- Closing a nuisance popup does not cancel a pending workflow step.
- Retries OTP submission using the panel's current code, without logging the code.
- Requires upload success within each document's own container before confirming
  all information. Selecting a local file alone does not mean it was uploaded.
- Reattaches documents on explicit upload errors; never repeatedly replaces
  selected files while their upload may still be running.
- Marks completion only after a submitted step disappears and another recognized
  step remains visible for at least 1.2 seconds, or explicit booking success.
- Restores a running session on page reload using the existing local setting.
- Excludes the extension's own panel from all page scans.

## Important boundaries

The cleaner dismisses HTML nuisance popups using explicit Close, Cancel, Dismiss,
OK or equivalent controls. It does **not** click every dialog button or remove
modal elements from the DOM. OTP, CAPTCHA, upload and other data-entry dialogs
are retained so their required work can finish. Unknown blocking dialogs wait for
manual attention rather than allowing clicks underneath them.

Native JavaScript alert/confirm/prompt boxes, browser permission dialogs, new
browser windows, closed shadow roots and cross-origin iframe contents cannot be
universally closed by this DOM content script.

CAPTCHA solving/ticking remains manual. The script waits for the provider's
response field and for loaders to disappear; it does not bypass CAPTCHA.
An inaccessible CAPTCHA that exposes no verified response will require
site-specific integration or manual continuation, not a guessed success state.

Booking/payment final confirmation remains manual. Clicking Continue Booking
does not mark an appointment booked.

## Site-specific selectors

The `PAGE` object in content.js holds the detection, loading, upload-success,
upload-error and booking-success selectors. Upload success accepts a scoped
status such as `data-upload-status="success"`, `.upload-success`,
`.ant-upload-list-item-done`, or a check mark in an upload status element.
Adjust these selectors to the real site's DOM if its markup differs.

Without a reliable success signal the script intentionally remains waiting.
There is no timeout that silently skips the unfinished step.

## Verification

Run `node --check extension/content.js`, `node --check extension/background.js` and
`node --test extension/tests/workflow.test.cjs` from the project root.
The tests exercise dispatcher logic using controlled page states; they do not
simulate the live visa site. Live authenticated flows, actual server upload
acknowledgments and CAPTCHA provider behavior have not been verified here.
