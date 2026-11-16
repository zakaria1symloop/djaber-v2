You fix bugs of the Djaber v2 app (monorepo `G:\Dev App\djaber v2`, pnpm + Turborepo: `apps/api` NestJS, `apps/web` Next.js,
`packages/shared` zod schemas + i18n, `packages/ui` design system, `packages/db` Prisma). Your areas: **{AREAS}**.

Read first:
1. `CLAUDE.md` (rules — tenancy, permissions, errors only from `docs/specs/11-error-catalogue.md`, every string an i18n key fr / ar / en,
   business rules in services, never print / commit secrets).
2. The bug list of each of your areas: `docs/audit/full-test-2026-11-15/areas/<area>.md` (format: `### ID — title`, Severity,
   Steps, Expected, Actual, Likely cause). The specs they cite: `docs/specs/*`, `docs/implementation/*`.
3. `docs/audit/full-test-2026-11-15/fix-status.md` — the IDs already fixed (skip them). Batch 1 is commit `1044e42`
   (`git show 1044e42 --stat`): reuse what it added (`parseIntegerInput` in `packages/ui/src/number-parse.ts`,
   `ORDER_TOTAL_BELOW_PAID`, `isPrivateKey`, `scenarioSummary`, the `2xl` column breakpoint …).

What to do — fix EVERY bug of your areas that is not in fix-status.md, most severe first:
- Fix the cause, and the same pattern elsewhere in your areas (memory « fix the class »). Small, focused edits with the Edit tool.
- Every behaviour change also goes into the spec that describes it (`docs/specs/*` or `docs/implementation/*`), and a
  decision the specs do not cover gets one line in `docs/implementation/assumptions-log.md` (append only, one line per decision,
  prefix « 2026-11-16 | full-test 15/11 <IDs> | »).
- **i18n:** do NOT edit `packages/shared/src/i18n/messages/*.json` yourself (several agents work at the same time). Write every key
  you add or change to your own file `.local/qa/fix/<first-area>-i18n.json` as `{ "fr": { "key": "text" }, "ar": {…}, "en": {…},
  "file": "app" }` (file = the message file family that already holds the neighbouring keys: app, web-gaps, admin-core, deck,
  web-public …; one JSON per family if you need several: `<first-area>-i18n-<family>.json`). The coordinator merges them.
  Arabic: Modern Standard Arabic, Latin digits. ICU placeholders `{name}`; a literal brace must not appear in a message.
- Data on the live site (CMS texts, presets, shop data) is NOT yours to change: if a bug can only be fixed by changing live data or
  by the owner (legal texts, content), write it in your report as « needs owner » with what to do.
- Do not run the integration tests (`jest.int.config.cjs`) — the coordinator runs them (one embedded Postgres at a time). Run:
  `pnpm --filter @djaber/api exec tsc --noEmit -p tsconfig.json`, `pnpm --filter @djaber/web exec tsc --noEmit -p tsconfig.json`,
  the unit tests you touch (`npx jest <file>` in apps/api, `npx vitest run <file>` in apps/web / packages/shared), and update /
  add unit tests for rules you change. If `packages/shared` changes, rebuild it: `pnpm --filter @djaber/shared build`
  (the web and api read its dist). Never `prisma migrate` / `db build` — if a fix needs a schema change, describe it in the report.
- Integration tests that your change makes outdated: update their expectations in `apps/api/test/**` (do not run them), list them.
- Do not commit, push, deploy, or touch the server / live site. Do not edit files outside your areas' code unless the bug's cause is
  there (shared components: keep the change minimal and say so). Another agent may edit other files at the same time.

Report (final message, and the same text in `.local/qa/fix/<first-area>-report.md`): one line per bug ID — `fixed` (file:line,
one sentence) / `needs owner` (what) / `not a bug` (why) / `not fixed` (why); the i18n files you wrote; the integration tests you
changed; any schema change needed.
