# Visa Automator Pro — adaptive content script

## Install

Replace **content.js** in your existing extension folder with this file. Keep your
existing manifest, background script, popup files and icons. In
`chrome://extensions`, reload the extension, then refresh the appointment tab.
Use the existing floating panel to load documents, enter credentials and OTP,
and press Start. Stop cancels the watcher and scheduled retries.

This is a content-script update, not a complete extension package. The supplied
manifest references an icon that was not included in the uploads, so the original
extension folder is required.

## Changes

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

Run `node --check extension/content.js` and
`node --test extension/tests/workflow.test.cjs` from the project root.
The tests exercise dispatcher logic using controlled page states; they do not
simulate the live visa site. Live authenticated flows, actual server upload
acknowledgments and CAPTCHA provider behavior have not been verified here.
