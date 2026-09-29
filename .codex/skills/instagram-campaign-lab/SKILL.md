---
name: instagram-campaign-lab
description: Analyze three or more social media reference accounts across Instagram, TikTok, YouTube Shorts, Facebook, LinkedIn, X, Pinterest, or other platforms and turn them into an original brand-safe campaign system. Use when the user wants to model a social account after other accounts, study competitors or inspiration accounts, create platform-native photo/video directions, campaign calendars, reels/shorts/TikToks, captions, prompts, Canva/imagegen briefs, metrics plans, or originality checks without copying protected content.
---

# Instagram Campaign Lab

## Overview

Use this skill to study 3+ social accounts as references and produce an original content system for the user's brand. Treat reference accounts as inputs for strategy, structure, quality bar, native platform behavior, and format patterns; never copy their exact photos, captions, logos, videos, offers, layouts, trends, audio, or protected assets.

## Workflow

1. Capture the user's brand, business type, audience, goal, offer, geography, and approval limits.
2. Require at least 3 reference accounts from one or more platforms. Accept handles, links, screenshots, captions, post notes, TikTok notes, Shorts notes, metric screenshots, or exported observations.
3. If only handles/links are provided, state that direct scraping is not performed unless a permitted connector/API is available. Ask for screenshots or notes only when needed; otherwise create a research checklist and draft strategy from supplied context.
4. Analyze each account across visual system, content mix, campaigns, native format, hooks, retention signals, copy, audience signals, offers, CTAs, cadence, and proof.
5. Extract shared patterns and translate them into ownable rules for the user's brand.
6. Produce a campaign system: content pillars, weekly/monthly campaigns, shot lists, reels, captions, prompts, Canva briefs, and measurement plan.
7. Run an originality check before finalizing: mark anything too close to a reference and rewrite it into a distinct direction.

## Output Standard

Return practical assets, not generic advice:

- Account-by-account DNA summary.
- Cross-account pattern map.
- "Our version" brand strategy.
- Photo/video direction with shot lists for 4:5 feed, 9:16 reels/stories/TikToks/Shorts, and platform-native variations.
- Campaign calendar with posts, reels, TikToks, Shorts, stories, captions, CTAs, offers, and metric targets.
- AI image prompts or photographer briefs.
- Canva/design brief when visual production is requested.
- Originality/compliance notes.
- Next inputs needed, especially screenshots, metrics, brand assets, or offers.

## Safety Rules

- Do not copy exact images, captions, layouts, logos, videos, identity systems, proprietary offers, or recognizable creative.
- Do not imply permission to use third-party assets.
- Avoid public security/privacy details or credentials if the work touches account access.
- Keep publishing, paid ads, account outreach, and external automation behind explicit human approval.
- When analyzing a living social account, prefer user-supplied screenshots/notes or an approved API/export. Do not promise full live account scraping.

## ASITENTE App

When working in this repository, use the local Instagram Campaign Lab module when possible:

- UI route: `/instagram-campaign-lab`
- API snapshot: `GET /api/instagram-campaign-lab`
- Create study: `POST /api/instagram-campaign-lab/studies`
- Server module: `server/instagram-campaign-lab.ts`
- Data file: `marketing_command_center_data/instagram-campaign-studies.json`

Use `references/analysis-schema.md` when a detailed analysis rubric is needed.

## Example Trigger

"Quiero llevar nuestra cuenta como estas cuentas de IG y TikTok. Analizalas y hazlo a nuestro modo."
