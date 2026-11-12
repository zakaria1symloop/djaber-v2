# Weak points of the v2 build — patterns behind the tester reports (12/11/2026)

Source: the 190 post-go-live rows of `docs/implementation/assumptions-log.md` (14/10 → 12/11: tester logs, PVs, recettes),
the 12/11 logs UX-058 … UX-065, and the detectors of `tools/qa/` run against the live site and database the same day.
Goal: find the bugs of the same family before the testers do, and stop fixing them one screen at a time.

## 0. The meta-pattern: the instance is fixed, the class stays

Most reports come back because a fix covers the screen the tester named, not the rule behind it.
Examples: UX-056 removed the codes from the listed screens → UX-059 found ~20 more; the 18/10 plan-name language fix
(admin) → the same language-source bug is still in recommendations, import errors, job texts (§1-b);
`ai_error` handoffs came back to the AI, other handoffs did not (A3 → retest 12/11).

**Rule from now on:** a tester log is closed only when (1) the instance is fixed, (2) the matching detector below was
run on the whole app and every hit fixed or logged, (3) the detector got a rule for that case if it missed it.

## 1. Patterns, counts, why the build produced them, detector

| # | Pattern | ≈ rows | Why it happened | Detector |
|---|---|---|---|---|
| 1 | AI behaviour held by the prompt only | 22 | ~50 « never / always » sentences, most added after a report; the server checks the JSON shape, ≤ 5 cards and (since 12/11) handoffs — nothing else of the reply | reply guard + eval per rule (§3) |
| 2 | Button / link with no effect or leading where the item isn't | 22 | screens built one by one from their frame; nobody walked the journey | `scan-links.mjs` (paths: 407 / 407 OK); journey e2e « every enabled control changes something » (to write) |
| 3 | Same figure computed differently in two places | 16 | each screen / report derives it again instead of one shared function | data invariants + « one definition » grep per KPI |
| 4 | Technical or untranslated text shown to the merchant | 15 + UX-059/060 | copy taken from spec / Figma notes (D42 « code in the menu footer »); `i18n:check` proves a key exists, not that the rendered text is human; server texts / seeds / enum values not localised | `text-leak-crawl.mjs` (fr / ar / en), `scan-placeholders.mjs` |
| 5 | Entity finished, dependents still open / actions still offered | 10 + UX-064 | state machines written per entity; cross-entity consequences not specified | `data-invariants.sql` |
| 6 | Integrations written from notes, fakes too kind | 10 | ZR / EcoTrack / Yalidine / Sheets / Meta / AI coded against our own docs, tested against our own fakes | contract tests against sandbox accounts / recorded real answers (to write) |
| 7 | Form contract broken (saved before « Enregistrer », typed input lost, filter reset) | 9 | sub-components write on their own | e2e « edit then Annuler ⇒ nothing stored » per form (to write) |
| 8 | Arabic / plural / look-alike matching | 7 | exact-word matching | shared normaliser + corpus test (fr, ar, darija, arabizi) |
| 9 | Disabled reason missing, wrong or raw | 7 + UX-060 | some reasons computed in the browser, some by the API, params not passed | crawler opens every « Actions » menu |
| 10 | Dates / time zone | 5 + UX-058 | no single formatter for files and AI tools | grep `toISOString()` in user-facing output |
| 11 | Abuse / duplicates / races | 5 + UX-061 | limits per IP only, user-triggered side effects not idempotent per identity | list every public endpoint that sends mail / SMS / creates rows: per-identity limit + « pending ⇒ no new one » |
| 12 | Asymmetric actions (add notifies, remove doesn't) | 4 | one direction implemented | pair list of notification types / actions |

## 2. What the detectors found on 12/11 (live, read-only)

### Text crawler — `tools/qa/text-leak-crawl.mjs` (shop « test's shop H-07 », 66 pages × fr / ar / en, menus opened)
Re-found by itself most of UX-059 / UX-060 (`{from} → {to}`, `(AGENT_NO_CHANNEL)`, `(AGENT_CHANNEL_SWITCH_NEXT_THREAD)`,
`(INBOX_INSIGHTS_UNAVAILABLE)`, `AgentVersion`, `CreditLedger`, `(D9)`, `(D15)`, `DLV-05`, `ORD-06`, `auto_banned_word`,
`order_address_updated`). **New, not in any log:**
- Delivery › Fees, tooltip of the greyed controls: « Réservé aux admins de l'espace (delivery.manage) » — permission key.
- Connected pages › page: Meta permissions listed raw « PAGES_MANAGE_METADATA · ACCORDÉE », « PAGES_MESSAGING »…
- Settings › Integrations › Sheets (English account): « (tab "Commandes", hidden column djaber_id) » — French tab name and a column key in the English UI.
- Arabic pages, text in another language: Recommendations shows the English sentences (« Variant at … sales / week … "unavailable" ») and « REFUSER »; Billing « démarrer »; Delivery « Montant supérieur à 150000 DA (limite ZR Express) » (a French courier-check reason stored as text); Channels « postbacks », « icebreaker »; Analytics tooltip « Africa/Algiers ».
Missed by the crawler (it runs under read-only impersonation): notification keys (the admin has no notification of that shop), queue reasons, order HISTORY lines (tabs are not `role=tab`), the hover-only « AUTO » tooltip, the Versions « Diff », `?PRODUCT=` hints. Next version: run as a real shop member (test account), click every tab-like control, hover elements with tooltips.

#### 1-b. Language source (new pattern found by the Arabic pass)
The request context carries the **shop's** language (`TenantInfo.locale = workspace.locale`), so ~15 server places write
text in the shop language whatever the viewer reads: recommendations (`stock-reco.service`, `cross-sell.service`), import
and page-analysis errors (`order-import.service`, `page.service`), job texts (`job.service.toDto`, `export.service`),
shipment view (`shipment.service`). `TenantInfo.requestLocale` (added 18/10 for the admin) is the viewer's language.
Rule to write in the specs: screens use the viewer's language; documents sent to the end customer (slips, tracking page,
customer messages) use the shop's / customer's language; e-mails use the recipient's.

### Data invariants — `tools/qa/data-invariants.sql` (live DB, read-only)
- I1 finished order with an open / failed delivery: **CMD-1008** only (= UX-064).
- Order vs delivery status, delivered not paid, variant stock sums, moderation status vs current item, invoice paid flags,
  customer counters (with counter sales): **no row**.

### Static scans
- `scan-links.mjs`: 407 literal links, all to existing pages — the « dead ends » are semantic (target page doesn't hold the item, UX-065; query values not supported), not broken paths.
- `scan-placeholders.mjs`: 1 static `t(key)` without its values (agents › behaviour template hint, intended documentation). The UX-060 raw `{from}` come from **dynamic** keys (`reasonText(code, params)`) — only the crawler sees them.
- Dates: the AI tools give the model UTC ISO times (`lookup_order`: `orderedAt`, `lastEvent.at`; `cancel_order` candidates). The model can tell a customer an hour off, or the wrong day between 00:00 and 01:00. Not reported yet.
- AI replies: no server check of prices / fees in the text against the catalogue and tool results, of IDs / statuses / tool names / stock counts / a second greeting / a self-given name. All of these are prompt sentences only.
- Notification pairs without their opposite (candidates, check against the specs): workspace deletion scheduled ↔ cancelled, member invited / joined ↔ removed, payment received ↔ refunded, shipment created ↔ cancelled.

## 3. Proposed next steps (by value)
1. **AI reply guard** (pattern 1): before sending, check the reply text — every amount with DA must be a catalogue price, a fee or a total returned by a tool; no UUID, tool name, status code or stock count; no greeting after the first reply; no personal name. A violation ⇒ one corrected retry, else the safe sentence. Map each prompt « never » to a guard or an eval scenario.
2. **Language source** (1-b): one helper `viewerLocale()` (requestLocale ?? user ?? workspace) for screen texts; fix the ~15 places; spec rule above.
3. **Crawler v2** as a shop member + run it after every deploy; add a rule each time a tester finds a leak it missed.
4. **Data invariants** in the nightly health job (rows ⇒ admin alert).
5. **AI tool dates** in Africa/Algiers wall-clock text.
6. Journey e2e: every enabled control does something; every form « Annuler » stores nothing; every « + N more » / deep link lands on a page that lists the item.
7. Integration contract tests against sandbox / recorded real answers before any courier / Google / Meta change.
