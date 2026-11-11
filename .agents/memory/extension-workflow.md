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

Dismiss nuisance HTML dialogs but preserve required data-entry, CAPTCHA and
workflow confirmation dialogs, even when a confirmation dialog has no inputs.
Wait for provider/upload acceptance rather than manufacturing success.

**Why:** Closing required forms or marking clicks complete contradicts the
user's persistence requirement. The original script's broad dialog-button
clicking was unsafe, so the implementation deliberately favors waiting when
site-specific evidence is unavailable. The user's live examples also showed
required appointment/detail confirmations inside dialogs with Close controls;
the original "close all popups" wording must not cancel these required steps.

**How to apply:** Add verified site-specific selectors when real markup is
available. Do not broaden to arbitrary dialog buttons or infer upload success
from a selected local file.

The user now wants a direct Phone OTP Auto-Fill companion: native Android SMS
filtering, Client Key pairing, and an HTTPS relay to the Chrome background worker,
replacing Termux and MacroDroid.

**Why:** The user explicitly replaced their earlier instruction to keep Termux
with a simpler Android companion flow.

**How to apply:** Keep phone pairing and consented on-device SMS filtering as
the source of OTPs. Do not restore the old LAN endpoint or substitute an unrelated
SMS provider. Keep once-per-code submission and manual override intact.

The user chose to keep fully automatic SMS reception rather than switching to
one-tap SMS User Consent when Play Protect blocked installation.

**Why:** The user explicitly selected "Keep fully automatic SMS" after the
per-message approval tradeoff was explained.

**How to apply:** Do not silently replace background SMS reception with
per-message consent. Treat installation policy and approval as a separate
constraint; do not promise that rebuilding or signing alone removes Google's block.

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
