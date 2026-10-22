# Figma text fixes — machine-applicable list (2026-10-11)

Scope: Figma file `3SieH2XU0UvTnTNRl991LO`, pages **"Web V2"** (id `898:24126`) and **"Mobile V2"**. Every "old text" below was read from the real frame text on 2026-10-11 (text layers, trimmed, `/` = line break inside one layer) and is an exact substring; "frame" is a prefix of the frame name (enough to find it on the page). Apply "new text" verbatim. The specs win over the Figma for every value (D65); the Figma keeps wording and layout.

Legend for codes: canonical codes are in `docs/specs/11-error-catalogue.md`; aliases only in 11 §13.

| page | frame name (prefix) | old text (exact substring) | new text |
|---|---|---|---|
| Web V2 | REF — Deep-link map | `order.created` | `order.ai_created` |
| Web V2 | REF — Deep-link map | `order.needs_call` | `order.callback_due` |
| Web V2 | REF — Deep-link map | `conversation.needs_human` | `conversation.handoff` |
| Web V2 | REF — Deep-link map | `credits.80 / credits.100` | `credits.80 / credits.exhausted` |
| Web V2 | REF — Deep-link map | `plan.expiring / plan.expired` | `subscription.expiring / subscription.expired` |
| Web V2 | REF — Deep-link map | `page.needs_reconnect` | `channel.needs_reconnect` |
| Web V2 | REF — Deep-link map | `page.approved` | `channel.approved` |
| Web V2 | REF — Deep-link map | `ai.provider_error` | `ai.error` |
| Web V2 | REF — Deep-link map | `member.joined / invitation.accepted` | `member.invited / member.joined` |
| Web V2 | REF — Deep-link map | `product.rejected / changes_requested` | `product.rejected / product.changes_requested` |
| Web V2 | REF — Entity & navigation map | `Propriétaire unique, non retirable. Au-delà du plan ⇒ lecture seule.` | `Propriétaire unique, non retirable par un tiers ; transfert possible vers un admin (mot de passe + 2FA). Au-delà du plan ⇒ lecture seule.` |
| Web V2 | ANA-01b — Home & Notifications | `order.created` | `order.ai_created` |
| Web V2 | ANA-01b — Home & Notifications | `order.needs_call` | `order.callback_due` |
| Web V2 | ANA-01b — Home & Notifications | `conversation.needs_human` | `conversation.handoff` |
| Web V2 | ANA-01b — Home & Notifications | `credits.100` | `credits.exhausted` |
| Web V2 | ANA-01b — Home & Notifications | `plan.expiring` | `subscription.expiring` |
| Web V2 | ANA-01b — Home & Notifications | `plan.expired` | `subscription.expired` |
| Web V2 | ANA-01b — Home & Notifications | `page.needs_reconnect` | `channel.needs_reconnect` |
| Web V2 | ANA-01b — Home & Notifications | `page.approved` | `channel.approved` |
| Web V2 | ANA-01b — Home & Notifications | `ai.provider_error` | `ai.error` |
| Web V2 | ANA-01b — Home & Notifications | `invitation.accepted` | `member.joined` |
| Web V2 | DLV-08 — Delivery — overview | `Suivi actualisé toutes les 30 min par transporteur (ou « Actualiser »).` | `Suivi actualisé toutes les 2 h pendant 3 jours après l'envoi, puis toutes les 12 h ; sans mouvement 30 j ⇒ « stale » (ou « Actualiser », 1 / 5 min).` |
| Web V2 | DLV-08 — Delivery — overview | `COURIER_UNAVAILABLE.` | `COURIER_UNAVAILABLE (notification shipment.failed · reason courier_unavailable).` |
| Web V2 | ORD-05 v2 — Orders — list (dense rows | `commande non confirmée (ORDER_NOT_CONFIRMED)` | `commande non confirmée (DELIVERY_ORDER_NOT_CONFIRMED)` |
| Web V2 | ORD-05 v2 — Orders — list — AR | `commande non confirmée (ORDER_NOT_CONFIRMED)` | `commande non confirmée (DELIVERY_ORDER_NOT_CONFIRMED)` |
| Web V2 | CAT-09 — Product page — full | `formats JPG/PNG/WEBP ≤ 8 Mo` | `formats JPG/PNG/WEBP ≤ 5 Mo · 10 images max · min 600 px` |
| Web V2 | GDS-07 — Purchases — list + receive dialog | `(PURCHASE_OVER_RECEIPT_WARNING)` | `(PURCHASE_OVER_RECEIVE · coût moyen pondéré recalculé)` |
| Web V2 | GDS-09 — Cash register | `pas de modification (CASH_ENTRY_LOCKED)` | `pas de modification (CAISSE_EDIT_AUTOMATIC)` |
| Web V2 | GDS-09 — Cash register | `(CashEntry.type)` | `(CashTransaction.category)` |
| Web V2 | GDS-09 — Cash register | `(CashEntry.method)` | `(CashTransaction.method)` |
| Web V2 | GDS-10 — Recommendations | `(RecommendationJob · 142 produits analysés sur 142)` | `(Job kind=recommendations · 142 produits analysés sur 142)` |
| Web V2 | GDS-10 — Recommendations | `(Workspace.targetMargin)` | `(Workspace.targetMarginPct, défaut 35 %)` |
| Web V2 | GDS-10 — Recommendations | `(Product.lowStockThreshold)` | `(Product.minStock)` |
| Web V2 | AGT-01 — Agents — list | `Passez à Business pour des agents illimités.` | `Passez à Pro pour 5 agents.` |
| Web V2 | AGT-02 — Agent wizard — step 2 knowledge | `Extraire depuis ma page Facebook (5 crédits)` | `Extraire depuis ma page Facebook (gratuit · 3 par jour)` |
| Web V2 | AGT-02 — Agent wizard — step 4 channels | `1 · COMPORTEMENT` | `1 · IDENTITÉ` |
| Web V2 | AGT-02 — Agent wizard — step 4 channels | `2 · PRÉSENTATION` | `2 · CONNAISSANCES` |
| Web V2 | AGT-02 — Agent wizard — step 4 channels | `3 · MODÈLE IA` | `3 · COMPORTEMENT` |
| Web V2 | AGT-02 — Agent wizard — step 4 channels | `4 · PAGES` | `4 · CANAUX` |
| Web V2 | AGT-02 — Agent wizard — step 4 channels | `5 · PRODUITS` | `5 · TEST & ACTIVATION` |
| Web V2 | AGT-02 — Agent wizard — step 4 channels | `gpt-4o-mini · température 0,5 · 1 400 tokens` | `Modèle attribué par la plateforme (lecture seule) · réglages du préréglage` |
| Web V2 | AGT-02 — Agent wizard — step 5 test & activate | `limite d'agents du plan (PLAN_AGENT_LIMIT)` | `limite d'agents du plan (PLAN_LIMIT · agents ; les brouillons ne comptent pas)` |
| Web V2 | AGT-07 — Agent playground | `gpt-4o-mini · temp 0,6 · 1 200 tokens max` | `Modèle attribué par la plateforme · réglages du préréglage` |
| Web V2 | CHN-06 — Channels — list | `passez au plan Business pour en connecter davantage` | `passez au plan Pro pour en connecter davantage` |
| Web V2 | ANA-02 — Analytics — overview tab | `ANALYTICS_RANGE_TOO_LARGE → limite 365 j` | `REPORT_RANGE_TOO_LONG → limite 732 j` |
| Web V2 | ANA-03 — Reports — hub | `EXPORTS RÉCENTS (ReportJob)` | `EXPORTS RÉCENTS (Job kind=export)` |
| Web V2 | BIL-01 — Settings — Plan & billing | `Passer à Business` | `Passer à Pro` |
| Web V2 | BIL-01 — Settings — Plan & billing | `12 900` | `4 900` |
| Web V2 | BIL-04 / BIL-03 — Credits page | `Historique (CreditTransaction)` | `Historique (CreditLedger)` |
| Web V2 | BIL-04 / BIL-03 — Credits page | `Confirmation du paiement auprès de SATIM…` | `Confirmation du paiement auprès de Chargily (CIB / Edahabia)…` |
| Web V2 | SET — Settings — Quick replies · System messages | `Messages système envoyés aux clients` | `Messages système envoyés aux clients (4 textes modifiables : transmission, hors horaires, rupture de stock, accueil)` |
| Web V2 | SET — Settings — Quick replies · System messages | `INDISPONIBLE (CRÉDITS / QUOTA)` | `TEXTE FIXE · INDISPONIBLE (CRÉDITS / QUOTA) — non modifiable` |
| Web V2 | SET — Settings — Quick replies · System messages | `QUAND : VIDÉO, FICHIER, STICKER ; VOCAL SI TRANSCRIPTION DÉSACTIVÉE` | `TEXTE FIXE · MÉDIA NON PRIS EN CHARGE — non modifiable` |
| Web V2 | SET — Settings — Quick replies · System messages | `VOCAL NON COMPRIS` | `TEXTE FIXE · VOCAL NON COMPRIS — non modifiable` |
| Web V2 | SET — Settings — Quick replies · System messages | *(add three cards after the handoff card)* | `HORS HORAIRES — Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture.` / `RUPTURE DE STOCK — Désolé, {product} est en rupture de stock pour le moment.` / `ACCUEIL — Bonjour 👋 Bienvenue chez {shop} ! Comment puis-je vous aider ?` |
| Web V2 | SET — Settings — Members & invitations | `jusqu'à un passage au plan Business` | `jusqu'à un passage au plan Pro` |
| Web V2 | SET — Settings — Integrations | `order.created · #CMD-1042` | `order.created · #CMD-1042 (événement webhook ; notification = order.ai_created)` |
| Web V2 | AUTH — States catalogue | `Code invalide (TWO_FA_CODE_INVALID)` | `Code invalide (AUTH_2FA_INVALID)` |
| Web V2 | AUTH — States catalogue | `(toujours, 30 min de validité)` | `(toujours, 60 min de validité)` |
| Web V2 | SET — Settings — Profile · Workspace · Security | `PNG/JPG · 1 Mo · utilisé sur PDF et étiquettes` | `PNG/JPG · 5 Mo · utilisé sur PDF et étiquettes` |
| Web V2 | DLG — Settings & billing | `PNG / JPG ≤ 2 Mo · carré recommandé` | `PNG / JPG / WEBP · 5 Mo max · carré recommandé` |
| Web V2 | GLOBAL — Plan expired — free limits applied | `passez au plan Business pour en connecter davantage` | `passez au plan Pro pour en connecter davantage` |
| Web V2 | MECH — Agents filters + row menu | `désactivé à la limite (PLAN_AGENT_LIMIT)` | `désactivé à la limite (PLAN_LIMIT · agents)` |
| Web V2 | MECH — Agents filters + row menu | `IA stoppée · CHANNEL_DISCONNECT_CONFIRM` | `IA stoppée (dialogue « Déconnecter la page », pas de code)` |
| Web V2 | MECH — Agents filters + row menu | `Agent.providerModelId → AiProviderModel (admin)` | `Agent.modelId → AiModel (attribué par la plateforme, lecture seule)` |
| Web V2 | MECH — Agents filters + row menu | `import depuis posts (IA) · coûte des crédits` | `import depuis posts (IA) · gratuit · 3 par jour` |
| Web V2 | MECH — Delivery filters + row menu | `COURIER_VALIDATION · COURIER_AUTH · COURIER_UNAVAILABLE` | `COURIER_VALIDATION · COURIER_CREDENTIALS_INVALID · COURIER_UNAVAILABLE` |
| Web V2 | MECH — Delivery filters + row menu | `ORDER_NOT_SHIPPABLE · déjà expédiée (ignorée)` | `DELIVERY_ORDER_ALREADY_SENT · déjà expédiée (ignorée)` |
| Web V2 | MECH — Delivery filters + row menu | `Shipment.status (not_sent · created · picked_up · in_transit · delivered · returned · failed)` | `Shipment.status (pending · sent · picked_up · in_transit · out_for_delivery · delivered · failed · returned · cancelled · stale)` |
| Web V2 | ADM-02 — Platform admin — workspaces | `• Mode : lecture seule (défaut) · écriture (confirmation + e-mail au propriétaire)` | `• Mode : lecture seule uniquement (aucun mode écriture en v2)` |
| Web V2 | ADM-02 — Platform admin — workspaces | `• Interdit : paiement, suppression d'espace, modification des membres (ADMIN_IMPERSONATION_FORBIDDEN_ACTION)` | `• Interdit : toute action autre que la lecture (ADMIN_IMPERSONATION_FORBIDDEN_ACTION)` |
| Web V2 | ADM-02 — Platform admin — workspaces | `lecture seule par défaut · bandeau rouge · raison obligatoire · journalisé · 30 min` | `lecture seule · bandeau rouge · raison obligatoire · journalisé · 30 min` |
| Web V2 | ADM-02 — Platform admin — workspaces | `CreditBalance.remaining / Plan.monthlyCredits` | `solde calculé (CreditLedger) / Plan.monthlyCredits` |
| Web V2 | ADM-02 — Platform admin — workspaces | `→ CreditTransaction` | `→ CreditLedger (action=grant)` |
| Web V2 | ADM-02 — Platform admin — workspaces | `STATUT : ACTIF · ESSAI · EXPIRÉ · SUSPENDU · SUPPRESSION PROGRAMMÉE (Workspace.status)` | `STATUT ESPACE : ACTIF · SUSPENDU · SUPPRESSION PROGRAMMÉE (Workspace.status) · ABONNEMENT : ESSAI · ACTIF · RELANCE · EXPIRÉ · ANNULÉ (Subscription.status)` |
| Web V2 | ADM-03 — Platform admin — users | `(USER_OWNS_WORKSPACE)` | `(ACCOUNT_OWNS_WORKSPACE)` |
| Mobile V2 | V2 — Boîte — Signaler à Djaber | `ABUSE_REPORT_DUPLICATE si déjà signalé` | `ABUSE_REPORT_ALREADY_OPEN si déjà signalé` |
| Mobile V2 | V2 — Paramètres — Clients bloqués | `(CUSTOMER_BLOCK_PLATFORM)` | `(CUSTOMER_BLOCKED_BY_PLATFORM)` |
| Mobile V2 | V2 — Crédits — Achat · états | `(POST /billing/packs/iap)` | `(POST /credits/packs/iap/validate)` |
| Mobile V2 | V2 — Système — Autorisation des notifications | `(POST /me/push-tokens)` | `(POST /me/devices)` |
| Mobile V2 | V2 — Système — Conditions mises à jour | `POST /me/legal-acceptances.` | `GET /legal/pending puis POST /legal/accept { key, version }.` |
| Mobile V2 | Page AI settings | `gpt-4o-mini` | `Modèle attribué par la plateforme (lecture seule)` |
| Mobile V2 | 14 — Agents IA | `gpt-4o-mini` | `Modèle attribué par la plateforme` |
| Mobile V2 | 14c — Agents IA · détails de l'agent · v2 · modifier | `gpt-4o-mini` | `Modèle attribué par la plateforme (lecture seule)` |
| Mobile V2 | 15c — Agents · modifier l'agent | `GPT-4O MINI · 0.6 · 1200 JETONS` | `MODÈLE ATTRIBUÉ PAR LA PLATEFORME · RÉGLAGES DU PRÉRÉGLAGE` |

## Web V2 — sections 12–14 (platform admin, public pages, dialog catalogues)

| page | frame name (prefix) | old text (exact substring) | new text |
|---|---|---|---|
| Web V2 | ADM-05 — Platform admin — subscriptions & invoices | `Paiement CIB/Edahabia (SATIM) ou manuel (virement, CCP, espèces agence). Relances automatiques J−7, J0, J+3, suspension J+7.` | `Paiement Chargily (CIB / Edahabia) ou manuel (virement, CCP, espèces agence). Relances automatiques J−7, J0, J+3 ; J+7 ⇒ abonnement expiré (limites du plan gratuit, jamais de suspension).` |
| Web V2 | ADM-05 — Platform admin — subscriptions & invoices | `4 à suspendre demain` | `4 expirent demain` |
| Web V2 | ADM-05 — Platform admin — subscriptions & invoices | `ÉTAT : ESSAI · ACTIF · RELANCE (dunning) · SUSPENDU · RÉSILIÉ (Subscription.status)` | `ÉTAT : ESSAI · ACTIF · RELANCE (dunning) · EXPIRÉ · ANNULÉ (Subscription.status = trial · active · dunning · expired · cancelled)` |
| Web V2 | ADM-05 — Platform admin — subscriptions & invoices | `PDF, statut SATIM, tentatives` | `PDF, statut Chargily, tentatives` |
| Web V2 | ADM-05 — Platform admin — subscriptions & invoices | `Reporter la suspension` | `Prolonger la période (+3 j / +7 j, motif)` |
| Web V2 | ADM-05 — Platform admin — subscriptions & invoices | `SUSPENDU` *(subscription pill)* | `EXPIRÉ` |
| Web V2 | ADM-08 — Platform admin — CMS per locale | `Maintenance SATIM dimanche 02:00–04:00` | `Maintenance Chargily dimanche 02:00–04:00` |
| Web V2 | ADM-12 — Platform admin — support tickets | `Ticket(category, priority, channel web\|mobile\|email\|chat, status, workspaceId, userId, assigneeId, firstResponseAt, slaDueAt)` | `SupportTicket(category, priority, channel web\|mobile\|email\|chat, status open\|pending_customer\|resolved\|closed, workspaceId, userId, assigneeId, firstResponseAt, slaDueAt)` |
| Web V2 | ADM-13 — Platform admin — platform settings | `SATIM (CIB / Edahabia)` | `Chargily Pay (CIB / Edahabia)` |
| Web V2 | ADM-15 — Platform admin — credit packs & promo codes | `Packs achetables (web : SATIM ; mobile : achat intégré Google Play / App Store obligatoire pour les biens numériques)` | `Packs achetables (web : Chargily CIB / Edahabia ; mobile : achat intégré Google Play / App Store obligatoire pour les biens numériques)` |
| Web V2 | ADM-16 — Platform admin — admin roles & account deletion | `Impersonation écriture` *(matrix row)* | *(delete the row — no write impersonation in v2)* |
| Web V2 | ADM-16 — Platform admin — admin roles & account deletion | `BLOQUÉE · USER_OWNS_WORKSPACE + dette` | `BLOQUÉE · ACCOUNT_OWNS_WORKSPACE + WORKSPACE_HAS_DEBT` |

Notes
- Rows for the last web frames (PUB status, PUB account deletion, DLG ×7) are listed in the third table below.
- Mobile base screens of section M99 (`⛔ REMPLACÉ`) are not fixed (not implemented).
- "5 crédits / photo" (AGT-02 step 3, V2 — Crédits) is correct (image recognition = 5 credits, D17) — no fix.
- Not text fixes but reading rules: `order.created` on SET Integrations / REF Entity map is the **webhook/WS event** name (kept); the notification type is `order.ai_created`.


## Application status

Applied on 2026-10-11 by script to the Figma file: **95 / 95 rows** (Web V2: 86 incl. the 3 special rows — 3 system-message cards added, subscription pill set to EXPIRÉ, write-impersonation matrix row deleted; Mobile V2: 9). The old page "Screens" and the Mobile V2 section M99 were intentionally left unchanged.
| Web V2 | CAT-09 — Product page — full | `Galerie (8 max)` | `Galerie (10 max)` |
| Web V2 | DLG — GDS (stock) II | `IMAGE_TOO_LARGE · max 8 Mo` | `IMAGE_TOO_LARGE · max 5 Mo` |
| Web V2 | DLG — GDS (stock) II | `IMAGES_LIMIT · 8 images max par produit` | `IMAGES_LIMIT · 10 images max par produit` |
| Web V2 | DLG — GDS (stock) II | `IMAGE_SMALL (< 500 px)` | `IMAGE_SMALL (< 600 px)` |
| Web V2 | DLG — GDS (stock) II | `Déposez 1 à 5 photos (JPG/PNG ≤ 8 Mo)` | `Déposez 1 à 5 photos (JPG/PNG/WEBP ≤ 5 Mo)` |
| Web V2 | DLG — GDS (stock) — dialogs catalogue | `correspondance par nom` | `correspondance par SKU` |
| Web V2 | DLG — Inbox & queue — popovers, message types, banners, composer states | `REPLY_OUTSIDE_WINDOW · champ désactivé + « Envoyer un message modèle » (FB) / « impossible » (IG)` | `Hors fenêtre : FB — réponse avec la balise agent humain tant que le serveur l'autorise (7 j) + « Envoyer un message modèle » ; ensuite REPLY_OUTSIDE_WINDOW, champ désactivé / « impossible » (IG)` |
| Web V2 | SAFE — Trust & safety (merchant) | `Les faux signalements répétés peuvent être sanctionnés.` | `Les signalements abusifs sont examinés par Djaber.` |
| Web V2 | QUEUE — File d'attente — items | `INCOMPRIS` / `HORS SUJET` | `INCOMPRÉHENSION` / `SUJET INCONNU` |
| Web V2 | DLG — Agents & channels — dialogs, connect flow & generate-from-page | `Tâche en arrière-plan · ~2 min / 1 000 conversations` | `Tâche en arrière-plan · 25 conversations × 25 messages au plus` (CHN-09) |
| Web V2 | DLG — GDS (stock) — dialogs catalogue | `Crée une ligne de caisse « Achat #ACH-0021 » (verrouillée) et met à jour Purchase.paidAmount.` | `Crée une ligne de caisse « Achat #ACH-0021 » (verrouillée) et met à jour le montant payé de l'achat.` |
| Web V2 | GDS-06 — Suppliers — list + detail sheet | `Voir les produits (14)` | `Voir les achats (18)` |
| Web V2 | GDS-07 — Purchases — list + receive dialog | `met à jour le coût unitaire moyen (Product.costPrice).` | `met à jour le coût unitaire moyen.` |
| Web V2 | ANA-02 — Analytics — overview tab + period picker | `Vue d'ensemble · Commandes · Conversations & IA · Produits · Clients · Livraison · Canaux & agents · Crédits` | `Vue d'ensemble · Conversations · Réponses IA · Consommation · Agents · Canaux · Produits · Commandes · Livraison` |
| Web V2 | ANA-02 — Analytics — overview tab + period picker | `Exporter (CSV · PDF)` | (remove: exports live in Rapports — keep `Rapports détaillés →`) |
| Web V2 | ANA-02b — Analytics — tabs Conversations · IA · Agents · Canaux · Produits · Commandes · Livraison | `> 732 j : « Période trop longue (max 2 ans) »` | `> 732 j : « Période trop longue : 732 jours max. »` |
| Web V2 | ANA-02b — Analytics — tabs Conversations · IA · Agents · Canaux · Produits · Commandes · Livraison | `Réponses & conso IA` | `Réponses IA` + `Consommation` (two tabs) |
| Web V2 | ANA-03 — Reports — hub (23 reports) + export jobs | `OPÉRATEUR : LECTURE, EXPORT CSV UNIQUEMENT` | `OPÉRATEUR : PAS D'ACCÈS (rapports = Admin+, 403)` |
| Web V2 | ANA-03 — Reports — hub (23 reports) + export jobs | `Ventes par client` · `Ventes par vendeur` (VENTES & REVENUS · 7) | `Remises` · `Synthèse des taxes` (the 7 = Ventes par période, Ventes par produit, Ventes par catégorie, Produits les plus vendus, Marges & rentabilité, Remises, Synthèse des taxes) |
| Web V2 | ANA-03 — Reports — hub (23 reports) + export jobs | `COMMANDES & LIVRAISON · 5` — `Commandes par statut` · `Commandes par wilaya` · `Taux de confirmation` · `Retours & motifs` · `Performance transporteurs` | `COMMANDES & LIVRAISON · 2` — `Retours & motifs` · `Paiements` (orders by status / wilaya, confirmation rate and couriers live in Statistiques › Commandes / Livraison) |
| Web V2 | ANA-03 — Reports — hub (23 reports) + export jobs | `STOCK · 6` — `État du stock` · `Mouvements` | `STOCK · 5` — `Valorisation du stock` · `Stock faible / rupture` · `Stock dormant` · `Rotation des produits` · `Écarts d’inventaire` (movements = the /movements list) |
| Web V2 | ANA-03 — Reports — hub (23 reports) + export jobs | `ACHATS & CAISSE · 4` | `ACHATS & CAISSE · 7` — `Achats par fournisseur` · `Achats par période` · `Achats par produit` · `Meilleurs fournisseurs` · `Journal de caisse` · `Encaissements vs décaissements` · `Dépenses` |
| Web V2 | ANA-03 — Reports — hub (23 reports) + export jobs | `CLIENTS & IA · 2` — `Clients par source` · `Conversations & taux IA` | `CLIENTS · 2` — `Meilleurs clients` · `Clients inactifs` (AI figures live in Statistiques) |
| Web V2 | DLG — Settings & billing — dialogs catalogue | `/facturation/retour?ref=… · après SATIM` | `/settings/billing/return?ref=… · après Chargily (CIB / Edahabia)` |
| Web V2 | DLG — Orders, delivery & clients II — dialogs catalogue | `montant = total · expire 48 h · envoyé par l’IA dans la conversation` | `montant = reste à payer · expire 15 min · un seul lien actif · envoyé dans la conversation` |
| Web V2 | DLG — Orders, delivery & clients II — dialogs catalogue | `Remboursement via le PSP (SATIM) · 3–7 j · ligne de caisse « remboursement » · commande → remboursée.` | `Remboursement enregistré : ligne de caisse « remboursement » verrouillée · commande → remboursée. Reversement au client depuis Chargily (CIB / Edahabia, 3–7 j) ou en espèces.` |
| Web V2 | BIL-01 — Settings — Plan & billing | card `Gratuit`: `50 produits` · `100 conversations / mois` · `500 crédits / mois` | `50 produits` · `200 conversations / mois` · `100 crédits / mois` (D68) |
| Web V2 | BIL-01 — Settings — Plan & billing | middle card `Pro`: `3 pages` · `3 agents` · `1 000 produits` · `2 000 conversations / mois` · `5 000 crédits / mois` · `3 membres` | card `Starter` 1 900 DA: `2 pages` · `2 agents` · `500 produits` · `2 000 conversations / mois` · `1 500 crédits / mois` · `3 membres` (D68; plan names / limits are `Plan` data) |
| Web V2 | BIL-01 — Settings — Plan & billing | third card `Business`: `10 pages` · `Agents illimités` · `20 000 crédits / mois` · `10 membres` | card `Pro` 4 900 DA: `5 pages` · `5 agents` · `Produits illimités` · `Conversations illimitées` · `5 000 crédits / mois` · `10 membres` (D68) |
| Web V2 | BIL-01 — Settings — Plan & billing | `Votre plan expire dans 7 jours. Sans renouvellement, les limites du plan gratuit s'appliqueront : 2 pages et 1 agent seront mis en pause (rien n'est supprimé).` | `Votre plan {plan} expire dans {days} jours ({date}). Renouvelez pour garder vos {pages} pages et {agents} agents.` (06 `banner.planExpiring`) |
| Web V2 | ADM-16 — Platform admin — admin roles & account deletion requests | matrix row `CMS & préréglages`: ✓ super admin · ✓ modérateur | `CMS & préréglages`: ✓ super admin only (01 §3.2 `admin.cms.write` / `admin.presets.write`) |
| Web V2 | ADM-05 — Platform admin — subscriptions & invoices | `Résilier immédiatement` · `passage en lecture seule · remboursement manuel hors outil` | `Résilier immédiatement` · `passage immédiat au plan gratuit (rien n'est supprimé) · remboursement manuel hors outil` |
| Web V2 | ADM-05 — Platform admin — subscriptions & invoices | `Montant partiel → facture reste impayée (INVOICE_PARTIAL_PAYMENT) ; montant supérieur → avoir sur la prochaine facture.` | `Montant partiel → facture reste impayée (INVOICE_PARTIAL_PAYMENT) ; montant supérieur au reste dû → refusé (VALIDATION_ERROR).` |
| Web V2 | DLG — Platform admin — dialogs catalogue (Exporter le journal d'audit) | field `RAISON *` · `Audit trimestriel` | (no reason field — the export job is itself audited, `AdminAuditExportSchema`) |
| Web V2 | ADM-16 — Platform admin — admin roles & account deletion requests | matrix row `Crédits : > 1 000 / grille tarifaire` ✓ super admin only | `Crédits : > 1 000` ✓ super admin · ✓ finance (AT-PRM-03); `grille tarifaire` joins the row `Fournisseurs IA, flags, versions app, maintenance, grille tarifaire` (super admin) |
| Web V2 | ADM-01 — Platform admin — overview (sidebar) | items end with `Paramètres plateforme` | add `Équipe plateforme` after `Paramètres plateforme` (02 §2.3) |
| Web V2 | SET — Settings — Integrations (Sheets · API keys · webhooks) | `Signature HMAC (X-Djaber-Signature), 6 tentatives sur 24 h, désactivation après 50 échecs consécutifs avec notification.` | `Signature HMAC (X-Djaber-Signature), 7 tentatives (1 min → 24 h), désactivation après 50 échecs consécutifs avec notification.` |
| Web V2 | SET — Settings — Integrations (Sheets · API keys · webhooks) | `502 · tentative 6/6` | `502 · tentative 7/7` |
| Web V2 | PUB — Public account deletion page (djaber.ai/compte/suppression) | `transférez d’abord la propriété ou supprimez la boutique depuis Paramètres › Zone de danger (USER_OWNS_WORKSPACE)` | `transférez d’abord la propriété ou supprimez la boutique depuis Paramètres › Zone de danger` (code of 11: `ACCOUNT_OWNS_WORKSPACE`, never shown to the visitor) |
| Web V2 | PUB — Public account deletion page (djaber.ai/compte/suppression) | frame name path `djaber.ai/compte/suppression` | `djaber.ai/account/deletion` (route map §3.1, link of the confirmation e-mail) |
| Web V2 | PUB — Legal (CMS) · Landing & help · Meta data-deletion status | `Statut de suppression de données Meta — /data-deletion/:code` | `Statut de suppression de données Meta — /meta/data-deletion/:code` (route map §3.1) |
| Web V2 | PUB — Pricing page (plans · FAQ · CTA) | badge `Populaire` on `Starter` | badge on the plan with `Plan.isFeatured` (seed: `Pro`) |
| Web V2 | DLG — Settings & billing — dialogs catalogue (Google Sheets — choisir la feuille) | `Après OAuth Google (pop-up)` | `Compte Google : {email}` (same-tab redirect of the contract; the dialog opens on return) |
| Web V2 | AGT-02 — Agent wizard — step 2 knowledge | `Importer un fichier (PDF, DOCX, TXT · 5 Mo)` | `Importer un fichier (DOCX, TXT · 5 Mo)` (PDF import open in carry-overs) |
| Web V2 | PUB — Legal (CMS) · Landing & help · Meta data-deletion status | `Voir une démo` | `Voir les fonctionnalités` (no demo exists; the button opens `/features`) |
| Web V2 | HELP — Help & support (merchant) | `Visite guidée` | `Bien démarrer` (opens the getting-started guides; no guided tour exists) |
| Web V2 | SET — Settings — Members & invitations | `le membre sera créé en lecture seule` | `changez de plan ou retirez un membre pour inviter (PLAN_LIMIT members)` |
| Web V2 | ONB-01 — Onboarding — step 3 | `Importer un fichier CSV/XLSX` | (remove — not built in the tunnel: the import comes from Produits once the setup is finished; 04 §25, assumptions-log 2026-10-15) |
| Web V2 | ONB-01 — Onboarding — step 3 | `Extraire depuis ma page Facebook (après l’étape 5)` | (remove — no page is connected at step 3; page extraction is offered from Produits after the setup) |
| Web V2 | ONB-01 — Onboarding — step 3 | `CATÉGORIE` (select) | (remove — a new shop has no category; the step keeps name, price, stock, photo) |
| Web V2 | GLOBAL — States, toasts, banners & system dialogs catalogue (banner "Suppression programmée le …") | action `Annuler` | `Annuler la suppression` (calls `POST /workspace/deletion/cancel` directly) |
| Web V2 | HELP — Help & support (merchant) (status card link) | `status.djaber.ai` | `Page de statut publique` |
| Web V2 | ADM-11 — Platform admin — reports (KPI strip label) | `Indicateurs des signalements` | `Indicateurs de sécurité` (the strip mixes reports and merchant blocks, UX-014) |
| Web V2 | ADM-11 — Platform admin — reports (tile « clients bloqués par les marchands · 7 j ») | `spam / insultes` | `manuels + règle auto · en vigueur` (the tile counts blocks of every reason, not spam / insult reports) |
