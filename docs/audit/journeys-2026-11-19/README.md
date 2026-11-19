# Journey verification round — live djaber.vercel.app — 19/11/2026

Second re-run of the journeys whose 18/11 re-run found Major / Blocker bugs or big fix batches, after the 18/11 fixes
(commits b292b27 → 578a4b3, all deployed). Same ground rules, table and output format as `../journeys-2026-11-16/README.md`.

Differences:
- Output: `journeys/J<NN>.md` in THIS folder; bug IDs `J<NN>v-<n>`.
- Each journey writes `RETEST J<NN>r-<n>: fixed | still broken (what) | cannot test (why)` for every bug of its 18/11 file
  (`../journeys-2026-11-18/journeys/J<NN>.md`) — this is the main goal — then runs the journey's main path again for regressions.
- A fresh shop per journey: owner `qa-j<NN>v-owner@test.djaber.local` (accounts in `.local/qa/journeys/accounts-J<NN>v.json`).
- Products of a fresh shop stay pending until approved: write the shop name to `.local/qa/journeys/J<NN>v/moderation-request.txt`;
  the coordinator approves journey shops' items every 2 minutes.
