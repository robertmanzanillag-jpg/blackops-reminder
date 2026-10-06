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

The durable PTC v1 runtime can reject both `Date.now()` and argument-free `new Date()`, despite the tool description describing them as supported.

**Why:** Evidence recording encountered both disabled APIs; retrying an explicit Date constructor did not bypass the restriction.

**How to apply:** Obtain an evidence timestamp through the read-only shell `date -u +%FT%TZ` callback instead of repeating Date API attempts. This is a sandbox limitation, not an application fault.
