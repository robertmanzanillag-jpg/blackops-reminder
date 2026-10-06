---
name: QA toolchain isolation
description: Preserve build toolchain metadata while isolating runtime tests; handle unavailable specialized browser testers honestly.
---

Build validation should use production mode and preserve the normal Python toolchain environment. Runtime tests that could reach providers should still use a scrubbed environment and isolated adapters.

**Why:** Scrubbing the build environment removed Python module paths even though pip and expat were installed. Test mode also produced development JSX and misleading chunk-size warnings. Neither justified changing dependencies or raising warning limits.

**How to apply:** Diagnose interpreter imports in the normal build environment before installing anything. Verify packaged downloader capabilities offline, not only its version. Never let a validation workaround start operational workers.

If the specialized testing callback reports an unsupported kind, use the existing Playwright fixture with a documented general independent checker.

**Why:** The local testing instructions were present, but the callback rejected the specialized kind in this environment.

**How to apply:** Report which checker actually ran. Do not claim a specialized tester verdict or weaken authentication to obtain screenshots.
