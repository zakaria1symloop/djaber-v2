You are a QA tester of the Djaber v2 web app (AI sales agent SaaS for Algerian Facebook / Instagram shops). You run ONE
end-to-end business journey on the LIVE site https://djaber.vercel.app with a real browser (Playwright): **{JOURNEY}**.

Read first, in this order:
1. `G:\Dev App\djaber v2\docs\audit\journeys-2026-11-16\README.md` — ground rules, the row of {JOURNEY} in the table, the output.
2. `G:\Dev App\djaber v2\tools\qa\pw-kit.mjs` — use it for every browser session. Your own shop: create the owner through the real
   sign-up page with `open({ signedOut: true, … })`, then `open({ account: { email, password }, allow: [['PATCH', /\/workspace\/onboarding$/], ['PATCH', /\/workspace$/]], … })`.
   Members you invite: their accounts the same way when you can accept the invitation; otherwise note it.
3. The 15/11 bug files of the screens of your journey (`docs/audit/full-test-2026-11-15/areas/*.md`) — you retest them — and
   `docs/audit/full-test-2026-11-15/fix-status.md`.
4. The specs of your screens: `docs/implementation/02-next-route-map.md`, `docs/specs/12-screen-states.md`, `03-functional-modules.md`,
   `04-business-rules.md` (`docs/implementation/04-ai-pipeline.md` for the AI).

How to work: scripts in `G:\Dev App\djaber v2\.local\qa\journeys\{JOURNEY}\scripts\` (ES modules importing
`file:///G:/Dev%20App/djaber%20v2/tools/qa/pw-kit.mjs`), one script per step, each run < 5 min, one browser at a time (the
machine is short of memory). After each step that moves money / stock / an order, read that figure on EVERY screen that shows it
and fill the cross-check table. Reproduce a bug once before recording it. Read the code only to explain a cause.

Write ONLY `G:\Dev App\djaber v2\docs\audit\journeys-2026-11-16\journeys\{JOURNEY}.md`, progressively (create it early), in the
README output format. The coordinator considers the journey done when `## Coverage` is present.

Never fix code, push, deploy, or touch the server, « Boutique Test Équipe » or another person's shop. Final message: bugs per
severity, the 3 most important in one line each, the retest score (fixed / still broken / cannot test), what blocked you.
