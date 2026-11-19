# Reviewed editorial clips

Use this path for an owned or licensed clip that needs its own duration, crop,
captions, and exact publication time. The owner approves those details for one
destination before a local render, then reviews the actual MP4 and its public
caption before preparation. FFmpeg, FFprobe, and ImageMagick run locally. The
renderer emits a receipt with measured output and audio duration, exact SHA-256
and zero spend. The existing renderer and learning experiments retain their
version and single-variable rules.

## Approve the edit before rendering

Keep the input and output review files under the workspace owner's control.
JSON approval files require owner-only mode and regular single-link files.
Hash the parsed JSON with `weeklyDigest`, which computes SHA-256 over
`JSON.stringify(value)`. Hash MP4 files over their original bytes.

Use these paths under `config/clippers-daily-learning`.

- `render-requests/<id>.json` contains `schemaVersion:2`, `id`, `brandId`,
  `network`, `account`, `renderClass:"reviewed_editorial"`, and
  `authorizationSha256`.
- `editorial-authorizations/<authorizationSha256>.json` contains the
  approval below. The ID and destination must match the request.
- `rights-evidence/<licenseEvidenceSha256>.json` contains the reviewed exact
  license described below.

```js
{
  schemaVersion: 2, kind: 'reviewed_editorial_authorization', id, destination,
  reviewedBy, reviewedAt, expiresAt, engineSha256,
  sourceFile, sourceUrl, sourceSha256, sourceStartSeconds,
  params: { duration, crop, caption_layout },
  captionText, scheduledAt, windowStart, windowEnd, rights, licenseEvidenceSha256,
  // Optional, already reviewed and timed relative to this clip
  subtitles: [{ startSeconds, endSeconds, text }],
}
```

Use a workspace-relative path to the original timed source MP4 or MOV.
`sourceStartSeconds` and `params.duration` identify the exact original interval.
Duration can be 5–90 seconds. Crop can be `left`, `center`, `right` or
`{x,y,width,height}` in original source pixels. A rectangle keeps its aspect
ratio in the portrait frame. Caption layout can be `off`, `upper`, `lower`,
or `header`. The header reserves space above the image for the title.
Use `captionText:''` for `off`. Optional subtitles contain up to 45 ordered,
distinct cues of at least 0.2 seconds each, within the approved duration.
`scheduledAt` is the exact UTC ISO timestamp with milliseconds. The
New York calendar window must contain the slot and end by that week's Sunday.

For an original text-card edit, use `params:{duration,crop:null,caption_layout:'off'}`
and `captionText:''`. Add
`visualPlan:{kind:'owned_cards',cards:[{startSeconds,endSeconds,heading,body}, ...]}`
to the authorization. Supply two or three adjoining cards covering the full
clip from second zero. Card headings fit 55 characters and bodies fit 170.
The local renderer generates all card pixels and takes the audio from the
approved source interval. Include **Excerpt + editorial graphics** in the
post caption for this format.

Rights must bind exact destination, source SHA, real original publication date,
observation time, approval expiry, reviewedBy, terms URL, commercial permission,
network and disclosure. Use the existing exact-asset rights fields
`destination`, `sourceSha256`, `sourcePublishedAt`, `observedAt`, `validUntil`,
`reviewedBy`, `termsUrl`, `sourceScope:'exact_asset'`,
`commercialPermission:'approved'`, `basis`, `membership`,
`permittedNetworks`, and `thirdPartyCommercial`. The owned basis requires
`ownership:'verified'`. For date-only source evidence, set
`sourceDatePrecision:'date_only'`, `sourcePublishedDate:'YYYY-MM-DD'`, and
`sourcePublishedAt:'YYYY-MM-DDT00:00:00.000Z'` in both rights and license.
That timestamp is the conservative freshness bound for the observed date.

The digest-addressed license repeats the rights fields and includes
`schemaVersion:1`, `kind:'reviewed_exact_asset_license'`, `sourceUrl`,
`permissionExpiresAt` and `reuseScope`. Set `permissionExpiresAt:null` when
the actual license gives no expiration. Both the authorization expiry and
the rights expiry must cover the exact slot. A campaign grant uses
`reuseScope:'exact_destination_only'`. Use `'licensed_crosspost'` only with
documented permission for the exact destination. Public licenses carry
`requiredAttribution`, which must appear in the reviewed post caption.
Add retained source and permission evidence when recording the license.
Repeat the review and grant for each destination.

The renderer requires that the actual source age be under 72 hours when
rendering and that the rights review be at most 24 hours old. Preparation
and scheduling recheck the exact output and current rights review before
dispatch, including the five-minute scheduling margin. A later expiry or
different slot requires a new reviewed request and render ID.

## Run and review a batch

```sh
node script/clippers-reviewed-editorial.mjs --engine-sha
CLIPPERS_WORKSPACE_ROOT=/absolute/workspace node script/clippers-reviewed-editorial.mjs --asset exact-id-one --asset exact-id-two
```

Each ID receives a separate result. Successful results identify the file and
its receipt hash. Read `reports/clippers-daily-learning/editorial-render-receipts/<id>.json`
for the immutable receipt and play the full export to check framing, speech,
subtitles, and graphics. Render receipts contain no publication approval.
An exact rerun returns the existing receipt, and changing a bound field
requires a new ID. If a render was interrupted while holding a lock,
verify the process is gone before removing that lock.

The owner then writes an exact output review at
`config/clippers-daily-learning/prepare-requests/<id>.json`. Use the ordinary
[portfolio prepare fields](clippers-portfolio-prepare.md#reviewed-inputs) with
`schemaVersion:2`, `renderClass:'reviewed_editorial'`, `authorizationSha256`,
and `reviewedAt`. Set `reviewedAt` at or after the verified render and before
the scheduled time. The exact render request, render receipt, output SHA,
source, destination, slot, caption and disclosure stay bound to that review.
Existing publication approval and provider evidence rules apply. These clips
use the weekly scheduling entrypoint and have no experiment or policy version.

## Verification and rollback

Run `node --test tests/clippers-reviewed-editorial.test.mjs` with FFmpeg,
FFprobe and ImageMagick. Fixtures exercise local renders and mocked media and
scheduling adapters. Keep the SHA-pinned engine file for all receipts produced
by this version. A later engine can be introduced as a distinct version.
To roll back new work, stop invoking this entrypoint and retain the original
outputs, approvals, receipts, and all existing scheduling evidence.
