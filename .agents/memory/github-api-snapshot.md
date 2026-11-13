---
name: GitHub source snapshots
description: Read-only reconstruction of an exact GitHub commit when archive downloads are blocked by the Replit connector.
---

When the GitHub App connector returns 403 for a repository archive, the commit tree and individual Git blobs may still be readable. Reconstruct the snapshot in a temporary directory, verify each Git blob SHA, and use bounded concurrency with backoff for 429 responses.

**Why:** Replit's connector allowed tree/blob reads while rejecting the archive route and rate-limiting bursts; the isolated snapshot was needed without changing the active checkout or permissions.

**How to apply:** Keep the snapshot outside the active app, omit secret/config files, do not reauthorize when permission changes are prohibited, and never treat the temporary copy as a persistent worker.
