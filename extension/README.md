# BLACK PANTHER — SLOT AUTOMATION

## Install

1. Download **black-panther-slot-automation.zip** and extract it fully. Do not select
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

This download is a complete Manifest V3 Chrome extension. Installation and the
base/manual-OTP workflow do not require Node.js or a running backend. Optional
Phone OTP auto-fill requires the supplied HTTPS relay and Android companion.
The toolbar and panel share the neon-cyan panther-mask mark in `icons/`.

Click the extension's Chrome toolbar icon to reopen a closed floating panel.
From another website, the icon opens the appointment site in a new tab. If the
toolbar icon shows a refresh indicator, refresh the appointment tab once.

## Black Panther panel

The compact panel is organized into **RUN**, **CONFIG**, **LOG**, and **DEBUG**.
RUN shows the live 10-step roadmap, current activity, four document slots
(Primary PDF and CO1–CO3), quick recovery actions, and workflow metrics. CONFIG
saves scan timing, rate-limit backoff, date range/order, live page mission/center
options, and automation toggles in extension storage. LOG and DEBUG contain
session events and non-sensitive diagnostics.

**Fetch OTP** checks the relay. **Fill OTP** forces a fresh relay check and fills
the visible official OTP field without submitting it; it will not overwrite a
code already typed on the page. Verify the code on the official page.

**Fix CF** only scrolls to the site's security challenge; solve it on the official
page. **Force Resume** rechecks the current step without bypassing upload,
CAPTCHA, or site confirmations. The extension stops at the payment handoff:
payment details, bKash PINs, and payment submission stay outside the extension
and must be handled manually on the official page.

## Fixing “Manifest file is missing or unreadable”

This error occurs when Chrome cannot find a readable `manifest.json` at the
top level of the selected folder. The earlier download was a content-script
update, not a complete extension. Use this complete ZIP instead.

The folder you select should look like:

```text
manifest.json
background.js
phone-relay.js
content.js
black-panther.css
icons/panther-16.png
icons/panther-48.png
icons/panther-128.png
options.html
options.js
README.md
```

If you downloaded the Replit project source rather than this ZIP, select its
**extension** subfolder, not the project root.

## Phone OTP companion (replaces Termux/MacroDroid)

Manual OTP entry still works without a server. Automatic fetching now uses the
native **Visa OTP Companion** Android app and your public HTTPS relay. The old
LAN/Termux endpoint and its permission have been removed.

1. Publish/run the supplied relay at a publicly reachable HTTPS address.
2. In the extension panel select **Relay setup**, enter only that HTTPS origin
   (no `/api` path), approve access to that one origin, and save.
3. In RUN, enable **Link phone relay** and copy the displayed **Client Key**.
   In CONFIG, keep **Auto OTP fill** and **Auto-submit OTP** enabled if you want
   the paired code filled and submitted automatically.
4. Install the companion APK on an Android 8+ phone you own. Enter the same relay
   address and Client Key, tap **Pair phone**, then grant SMS access after reading
   the disclosure. The key must be paired within ten minutes and is single-use.
5. Keep the IVAC OTP tab active in Chrome and run the automator. Android pushes a
   matching SMS code to the relay immediately; the relay wakes Chrome's authenticated
   wait request so the code arrives without waiting for a polling interval.

**Copy** copies the key; **New key** revokes the previous phone and pending OTP.
The relay switch pauses delivery and erases any queued relay code.
Pairings last 24 hours. RESET also attempts remote revocation before clearing all
extension storage. If the relay cannot be reached, unpair on the phone too.
No public relay URL is included in the ZIP; the project must be published or
the relay hosted before another device can reach it.

While running on the OTP screen, the extension holds one authenticated relay
request open for up to 20 seconds. Android's OTP POST wakes it immediately; after
a timeout or connection loss, Chrome reconnects. The worker shares one open wait
request and a manual Fetch OTP action remains an immediate read. Once a valid
code arrives it fills the website's
OTP field, clicks Verify/Submit **once**, then only watches for verification.
It does not click Verify again after a timeout, spinner, rerender or Stop/Start.
Codes are not written to extension storage or logs.

If you type or paste directly into the website, the extension will not overwrite
or automatically submit that input. Verify it yourself; the automator detects
the form submission or the stable transition to the next recognized step and
continues. An explicit rejection/expiry signal permits a **new, different**
code, but never automatically retries the same code.

## Changes

### Workflow and panel update (2.3.0)

- Android attempts its HTTPS POST as soon as the matching SMS is parsed. The
  relay wakes an authenticated Chrome long-poll immediately; PostgreSQL
  notifications reach waiters on other API instances too. A 20-second timeout
  reconnects after suspension or connection loss. The worker limits one active
  wait per pairing and leaves manual Fetch OTP as an immediate read.
- Once received, the extension fills the field and clicks Verify once. The
  existing duplicate guard, manual override, CAPTCHA wait, and transition check
  remain in place. Carrier, OS, network, and browser suspension can still add time.
- Recognizes **Next Step**, **Confirm All Information is Correct**,
  **Save & Continue**, and **Confirm Mission & IVAC Center**.
- Preserves required confirmation dialogs instead of dismissing their Close button.
  Recognized next-step modals no longer block completion of the previous screen.
- Supports native center selects and accessible custom combobox/listbox controls,
  without changing the preselected mission.
- Calendar discovery includes plain numeric day buttons, accessible calendars and
  existing available-day selectors. Disabled dates remain excluded. Continue is
  attempted after date selection without a fixed wait; failed attempts rotate
  middle-first with at least 20 seconds after Continue before another date.
- Upload continuation still requires each loaded document's server acknowledgment
  and a completed host CAPTCHA response. Reaching payment stops the extension.

- Start checks the page immediately. A landing-page Sign In link is opened when
  the credentials form is not yet visible; saved phone/password are then filled.
- The normal flow is Sign In → OTP → Take Your Appointment → Next → documents →
  Continue → Mission/IVAC → Save and Continue → calendar → payment/confirmation.
  Detection can also resume at a later visible screen.
- Four document slots are available, including file persistence and RESET.
  The selected primary document is always acknowledged before any secondary
  document is attached. If no primary is selected, the first loaded slot is used
  first; an explicitly selected but empty primary slot waits for its file.
- Upload fields may be disabled or waiting on CAPTCHA/loading; automation waits
  without using a different field to bypass the primary upload.
- Multiple website inputs and a single reusable upload input are supported.
  Each new document needs its own fresh acknowledgment. An old green tick from a
  previous document is not enough to confirm the next one.
- Continue/Next is clicked only after every loaded file is acknowledged and
  required website slots are satisfied. Optional empty slots do not require
  extra files. No upload timeout silently skips a document.
- The website's selected mission is preserved. The extension waits for enabled
  IVAC options, keeps an existing valid center or selects a preferred available
  center (otherwise the first enabled center), then uses the page's continuation
  control. An unavailable configured preference does not block selection.
- The calendar scans clickable dates in middle-first order: for five dates,
  positions 3, 4, 2, 5, 1, then repeats. Disabled dates are excluded.
- Each attempt selects a date and clicks Continue Booking once. If the page
  stays on the calendar, another date is tried after at least **20 seconds**.
  A visible countdown shows the wait; retry position and timing survive reloads.
- Automation stops when a payment/confirmation page is detected. It does **not**
  click Pay, purchase, or final-confirm controls. Reaching payment does not mark
  an appointment as paid or booked.

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
- Keeps one pending workflow action; non-OTP retries use a 3–20 second backoff.
- Closing a nuisance popup does not cancel a pending workflow step.
- Submits each OTP once and remains active while waiting for verification.
- Requires upload success within each document's own container before confirming
  all information. Selecting a local file alone does not mean it was uploaded.
- Reattaches documents on explicit upload errors; never repeatedly replaces
  selected files while their upload may still be running.
- Marks completion only after a submitted step disappears and another recognized
  step remains visible for at least 1.2 seconds, or an explicit success signal.
  Upload completion additionally requires every loaded document acknowledged and
  the upload continuation action sent.
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
does not mark an appointment booked. Payment is recognized by explicit page
markers, a payment/checkout/confirmation URL path, or a matching main heading.
Adjust `PAGE.payment` if the site's markup differs.

## Site-specific selectors

The `PAGE` object in content.js holds detection, loading, OTP success/error,
upload-success, upload-error and booking-success selectors. Adjust `otpOK` and
`otpError` to the site's actual explicit success/rejection markup if needed.
Upload success accepts a scoped
status such as `data-upload-status="success"`, `.upload-success`,
`.ant-upload-list-item-done`, or a check mark in an upload status element.
Adjust these selectors to the real site's DOM if its markup differs.

Without a reliable success signal the script intentionally remains waiting.
There is no timeout that silently skips the unfinished step.

## Verification

Run `node --check extension/content.js`, `node --check extension/background.js` and
`node --test extension/tests/*.test.cjs` from the project root.
The tests exercise dispatcher logic using controlled page states; they do not
simulate the live visa site. Live authenticated flows, actual server upload
acknowledgments and CAPTCHA provider behavior have not been verified here.
