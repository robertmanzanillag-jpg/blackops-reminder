# Claude Code Project Memory

This repo already has the source of truth for agent rules in `AGENTS.md`.
Read it before code, config, security, deployment, production, or customer-facing UI work.

## Operating Rules

- Keep the setup lean. Prefer one focused skill or subagent over a large swarm.
- Use `docs/codebase-map.md` before broad repo exploration, then inspect source files directly.
- Do not edit `.env`, secrets, credentials, private keys, OAuth tokens, recovery codes, `credentials/`, `secrets/`, `.git/`, or `node_modules/`.
- Bug, threat, security, and production fixes are PR-first. Never commit directly to `main` for agent-generated fixes.
- App QA is the release gate. If QA reports warnings or failures, do not deploy.
- Replit deployment requires explicit Robert approval after the PR and QA summary.
- Security details should use the least-public channel available.

## Lean Claude Code Reinforcement

Use these project skills instead of installing a large framework by default:

- `/project-scout` before architecture lookup, route/API lookup, impact analysis, or test targeting.
- `/pr-first-fix` for bug, production, threat, or security repair work.
- `/review-pr` when Robert asks to review a pull request, inspect agent-generated PR work, or check a branch before merge.
- `/qa-gate` before saying a code/config/UI change is ready.
- `/skill-scout` only when a repeated workflow should become a new skill.
- `/marketing-autopilot` for ads, campaigns, creatives, hooks, offers, funnels, tracking, Metricool, captions, publishing queues, and marketing analysis.
- `/design-creative` for design, UI/UX, branding, Canva, flyers, landing pages, promo visuals, layouts, mockups, and visual QA.

The BlackOps web and Telegram assistants also read relevant local `.claude/skills/*/SKILL.md` files through `server/claude-skill-bridge.ts`. Keep marketing/design skill instructions concise because selected skill bodies are injected into chat prompts.
Token controls for the bridge:

- `BLACKOPS_SKILLS_MAX_ACTIVE` defaults to `2`.
- `BLACKOPS_SKILLS_MAX_BODY_CHARS` defaults to `1400`.
- `BLACKOPS_SKILLS_MAX_CONTEXT_CHARS` defaults to `4200`.
- `BLACKOPS_SKILLS_MIN_SCORE` defaults to `6`.
- `BLACKOPS_SKILLS_CACHE_TTL_MS` defaults to `30000`.

When no skill matches the current message, the bridge injects no skill context.

Do not add new agents, hooks, MCP servers, dependencies, or automations unless they remove repeated work or enforce an existing safety rule.

## Completion Shape

For agent-generated PR-ready work, report:

- What broke or what risk was found.
- What changed.
- Files changed.
- Tests/build checks run.
- QA or reviewer summary.
- Risks and rollback note.
- Whether deployment is waiting for approval.
