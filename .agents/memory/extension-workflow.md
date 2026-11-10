---
name: Extension workflow boundaries
description: Scope and safety decisions for the Visa Automator Pro content-script update.
---

This request is an update to the user's uploaded Chrome extension, not a request
for a separate web dashboard or replacement authentication system.

**Why:** The user asked specifically to make content.js detect the current page
and persist until unfinished steps complete; a standalone web app would not
change the extension's behavior.

**How to apply:** Deliver a drop-in content script for the original extension.
Keep its existing panel and supporting scripts unless changes are necessary.

Dismiss nuisance HTML dialogs but preserve required data-entry and CAPTCHA
dialogs. Wait for provider/upload acceptance rather than manufacturing success.

**Why:** Closing required forms or marking clicks complete contradicts the
user's persistence requirement. The original script's broad dialog-button
clicking was unsafe, so the implementation deliberately favors waiting when
site-specific evidence is unavailable.

**How to apply:** Add verified site-specific selectors when real markup is
available. Do not broaden to arbitrary dialog buttons or infer upload success
from a selected local file.
