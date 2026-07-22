# HeyGen account maximum-quote decision

Status: fail closed (reviewed 2026-07-22).

## Official evidence

- `GET /v3/users/me` exposes the authenticated account's billing type, currency,
  remaining wallet/credit balance, and usage-based cap. It does not return a
  price or quote for a proposed video:
  https://developers.heygen.com/user-profile
- HeyGen publishes self-serve rates per second of completed output. Those rates
  describe billing, but are not an account-specific pre-generation quote and do
  not determine the eventual duration of a text-script render:
  https://developers.heygen.com/docs/pricing
- `POST /v3/videos` creates a video job. Its documented request and response do
  not include a quote-only/dry-run option, estimated duration, estimated cost,
  quote identifier, or quote expiry:
  https://developers.heygen.com/reference/create-video
- The official documentation index lists the public developer surface and no
  quote or estimate endpoint:
  https://developers.heygen.com/llms.txt

## Runtime rule

The HeyGen account maximum-quote adapter returns
`authoritative_account_quote_unavailable`. Public rates, script word counts, or
wallet balance must never be converted into maximum-quote evidence. Generation,
reservation, spend, outbox, publishing, and provider POSTs remain blocked.

The adapter may return `quoted` only after HeyGen exposes an authoritative
account-specific quote source (or an account contract supplies equivalent exact
terms) with integer micro-USD, USD currency, a source evidence digest, and an
expiry bound to the locked account, credential version, subject, and render
specification.
