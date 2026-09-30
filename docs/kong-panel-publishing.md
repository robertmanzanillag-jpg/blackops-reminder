# KONG panel for Daily Planner

The static `/kong-directory/` page shows aggregate local directory counts as a dated snapshot. It does not run a crawler, invoke AI, or claim live connectivity. No contacts, candidates, source URLs, credentials, machine paths or person records are included. Existing Replit hosting may still incur its normal costs; this change does not promise free hosting.

The Mac service remains responsible for discovery. Its launch agent resumes at user login with the SSD mounted and internet available. A powered-off or sleeping Mac cannot crawl.

## Update the snapshot

Fetch the local `/api/local-status` to a temporary file, then run:

```
node script/kong-panel-snapshot.mjs /tmp/kong-panel-status.json client/public/kong-directory/snapshot.json
node --test tests/kong-panel-snapshot.test.mjs
```

Review the diff and publish through the usual PR/QA/approval gate. This version has **no automatic cloud synchronization**. Browser refresh reloads the published copy only. A later synchronization feature needs authenticated device pairing, persistent user-scoped storage, schema validation and a separate security review; do not create a public write endpoint or copy browser sessions into source files.

## QA and rollback

Check `/kong-directory/`, load/error/retry states, count reconciliation, keyboard controls, and the local link. The local link only works on the host Mac. Vite copies `client/public` into the built app without server changes. Roll back by reverting the panel commit and republishing. No database migration, deployment-type change or local service restart is required.
