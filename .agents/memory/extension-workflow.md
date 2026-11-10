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
