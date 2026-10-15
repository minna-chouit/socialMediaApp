# Cadence

Single-user social media planner with an MCP connector for Claude.

- Spec (source of truth for the software): `docs/SRS.md`
- Background on the content strategy: `docs/strategy.md` (context only; if it disagrees with the SRS, the SRS wins)

## Rules
- Strict TDD: write a failing test first, named with its SRS ID
  (e.g. `it('R2: ...')`), run it and confirm it fails, then implement.
- Work one SRS ID at a time: red, green, refactor, commit.
- Business logic lives only in `packages/core` as pure functions.
- Core never calls `Date.now()` or `new Date()`; use the injected Clock.
- All scheduling uses the owner's timezone (default Africa/Algiers).
- Planning week = Saturday 00:00 to Friday 23:59 local time.
- Claude-facing (MCP) tools never delete and never change a post's stage.
- Accessibility: WCAG 2.2 AA; every Playwright test runs axe.
- TypeScript strict everywhere.
- Commit messages start with the SRS ID (e.g. `R2: adjacent pillar check`).
- Build milestones in order (SRS section 9). Do not start a milestone
  until the previous one has CI green and full ID coverage.

## Commands
- `pnpm test`       # all unit tests
- `pnpm test:db`    # pgTAP (stub until M4)
- `pnpm test:e2e`   # Playwright (added in M6)
- `pnpm trace`      # SRS ID traceability check (bump the milestone in package.json each milestone)
