# Journey re-run — live djaber.vercel.app — 18/11/2026

Re-run of the 14 journeys of 16/11 (`../journeys-2026-11-16/README.md`: same ground rules, table, output format) after the
journey fixes, 21 live AI retest rounds (R1–R21) and the full-suite pass of 18/11 (commit `4464d27`, API + web deployed).

Differences from 16/11:
- Output: `journeys/J<NN>.md` in THIS folder; bug IDs `J<NN>r-<n>`.
- Each journey also writes `RETEST J<NN>-<n>: fixed | still broken (what) | cannot test (why)` for every bug of its 16/11 file
  (`../journeys-2026-11-16/journeys/J<NN>.md`), besides the 15/11 retest lines.
- A fresh shop per journey: owner `qa-j<NN>r-owner@test.djaber.local` (accounts in `.local/qa/journeys/accounts-J<NN>r.json`).
- The AI journeys (J03, J04) keep their 100-message budget (60 / h / shop) and the R1–R21 guarantees as extra checks.
