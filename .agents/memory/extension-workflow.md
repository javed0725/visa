---
name: Extension workflow boundaries
description: Scope and safety decisions for the Visa Automator Pro content-script update.
---

This product is the user's uploaded Chrome extension, not a request
for a separate web dashboard or replacement authentication system.

**Why:** The user asked specifically to make content.js detect the current page
and persist until unfinished steps complete; a standalone web app would not
change the extension's behavior.

**How to apply:** Deliver a complete, unpacked-loadable Chrome extension with
manifest.json at the archive root. The user tried to load the earlier
content-script-only update directly in Chrome and received “Manifest file is
missing or unreadable.” They explicitly requested a standalone Chrome extension.
Preserve the on-page panel and adaptive workflow; do not substitute a website.

Dismiss nuisance HTML dialogs but preserve required data-entry and CAPTCHA
dialogs. Wait for provider/upload acceptance rather than manufacturing success.

**Why:** Closing required forms or marking clicks complete contradicts the
user's persistence requirement. The original script's broad dialog-button
clicking was unsafe, so the implementation deliberately favors waiting when
site-specific evidence is unavailable.

**How to apply:** Add verified site-specific selectors when real markup is
available. Do not broaden to arbitrary dialog buttons or infer upload success
from a selected local file.

The user uses a Termux Flask server, with MacroDroid forwarding incoming SMS to
that server; the panel retrieves OTPs through the Chrome background script.

**Why:** The user explicitly asked to keep this integration, not replace it.

**How to apply:** Preserve the MacroDroid → Flask → Chrome background → panel
workflow when changing OTP handling. Do not add an unrelated SMS provider.

OTP is an exception to the general action retry policy: submit a received code
once, then remain active while waiting for verification. Manual website OTP entry
and verification must be respected and followed by automatic workflow resumption.

**Why:** The user specifically rejected endlessly retrying or spamming OTP
verification while also rejecting premature automation stops.

**How to apply:** Keep detection persistent, not submission. Never treat a
Verify click as success or overwrite an in-progress manual entry.

On the Mission/IVAC page, the user says the mission is already selected;
the automator should select an available IVAC center without changing that mission.

**Why:** The user explicitly described this page behavior and requested selecting
the available center, not replacing the mission using panel configuration.

**How to apply:** Preserve the page's mission and wait for enabled center options.

The user's requested continuation is Save and Continue → calendar dates chosen
from the middle, with a 20-second delay between failed attempts, until payment.

**Why:** The user added this sequence explicitly, including continuous date
rotation rather than repeatedly trying one date.

**How to apply:** Keep automatic calendar retries separate from OTP's
single-attempt policy. Stop at payment/confirmation; payment and final
confirmation remain manual.
