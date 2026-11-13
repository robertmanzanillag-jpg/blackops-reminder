---
name: Pinned Docker image verification
description: Verify official image provenance and immutable platform digests before isolated execution.
---

Treat image tags as lookup references only. Confirm the tag and upstream source in Docker's Official Images index, verify registry index and platform manifest digests, and check the config blob's version before pulling the immutable platform digest. Some Registry V2 blob responses omit `Docker-Content-Digest`; hash the raw response and compare it with the digest referenced by the manifest.

**Why:** The factory requires a trusted, digest-pinned execution image, and a Registry config-blob response did not include a digest header.

**How to apply:** Record the official source, upstream commit, tag, index and platform digests, config digest, version, and architecture before pull; use only the immutable image reference for the test.
