# 06 — i18n & copy deck

## 1. Approach

- Source of truth for keys: `packages/shared/src/i18n/keys.ts` (typed union) + message files `packages/shared/src/i18n/messages/{fr,ar,en}.json`. Web (`next-intl`), mobile (`slang` loading the same JSON files copied into `apps/mobile/assets/i18n/` at build — `10-flutter-mobile.md` §9) and API (error messages, notification titles, exports, PDF) all read these files.
- Key naming: `<area>.<screen|component>.<element>[.<state>]` in camelCase segments; enums: `enum.<Entity>.<field>.<value>`; errors: `error.<CODE>`; validation: `validation.<key>`; notifications: `notification.<type>.title|body`; customer messages: `customer.<key>` (workspace-editable defaults). Params in ICU `{name}`; plurals in ICU.
- FR is written first from the Figma frames (verbatim); AR/EN columns left empty here are filled by the translator before M1 exit (CI fails on missing keys; until then `pnpm i18n:fill` copies FR into empty AR/EN with a `⟦TODO⟧` prefix so the check passes in dev only — never in CI).
- Page-specific copy not listed here is read from the Figma frame named in `02-next-route-map.md`; the coder adds keys under that screen's namespace with the FR text copied verbatim from the frame.
- Rules (RTL and formats): see §6.

---

## 2. Shared UI keys (FR from Figma; AR/EN to translate)

### 2.1 Navigation (`nav.*`) — frame `ANA-01 — Home — default`, admin sidebar `ADM-01`

| Key | fr | ar | en |
|---|---|---|---|
| nav.home | Accueil | | |
| nav.queue | File d'attente | | |
| nav.inbox | Boîte de réception | | |
| nav.orders | Commandes | | |
| nav.delivery | Livraison & suivi | | |
| nav.clients | Clients | | |
| nav.group.stock | STOCK | | |
| nav.stockDashboard | Tableau de bord stock | | |
| nav.products | Produits | | |
| nav.services | Services | | |
| nav.categories | Catégories | | |
| nav.movements | Mouvements | | |
| nav.suppliers | Fournisseurs | | |
| nav.purchases | Achats | | |
| nav.sales | Ventes | | |
| nav.cash | Caisse | | |
| nav.recommendations | Recommandations | | |
| nav.group.ai | IA & CANAUX | | |
| nav.agents | Agents IA | | |
| nav.channels | Pages connectées | | |
| nav.group.analysis | ANALYSE | | |
| nav.analytics | Statistiques | | |
| nav.reports | Rapports | | |
| nav.notifications | Notifications | | |
| nav.settings | Paramètres | | |
| nav.help | Aide | | |
| nav.settings.profile | Profil | | |
| nav.settings.workspace | Espace de travail | | |
| nav.settings.members | Membres | | |
| nav.settings.stockMode | Mode stock | | |
| nav.settings.quickReplies | Réponses rapides | | |
| nav.settings.systemMessages | Messages système | | |
| nav.settings.security | Sécurité | | |
| nav.settings.integrations | Intégrations | | |
| nav.settings.billing | Plan & facturation | | |
| nav.settings.credits | Crédits | | |
| nav.settings.danger | Zone de danger | | |
| nav.delivery.overview | Vue d'ensemble | | |
| nav.delivery.fees | Grille des frais | | |
| nav.delivery.couriers | Transporteurs | | |
| nav.admin.tag | PLATEFORME · SUPER ADMIN | | |
| nav.admin.overview | Vue d'ensemble | | |
| nav.admin.workspaces | Espaces de travail | | |
| nav.admin.users | Utilisateurs | | |
| nav.admin.moderation | Modération | | |
| nav.admin.reports | Signalements | | |
| nav.admin.support | Support | | |
| nav.admin.plans | Plans | | |
| nav.admin.subscriptions | Abonnements & factures | | |
| nav.admin.credits | Crédits & promos | | |
| nav.admin.ai | Fournisseurs IA | | |
| nav.admin.presets | Préréglages d'agents | | |
| nav.admin.cms | Contenu (CMS) | | |
| nav.admin.audit | Journal d'audit | | |
| nav.admin.health | Tâches & santé | | |
| nav.admin.settings | Paramètres plateforme | | |
| nav.admin.backToWorkspace | ← Retour à mon espace | | |
| topbar.credits | {used} / {limit} | | |
| topbar.workspaceSwitcher.create | + Créer un espace | | |
| userMenu.profile | Profil | | |
| userMenu.language | Langue : {language} | | |
| userMenu.createWorkspace | Créer un espace | | |
| userMenu.platform | Plateforme | | |
| userMenu.logout | Déconnexion | | |
| userMenu.logoutAll | Déconnecter tous les appareils | | |

### 2.2 Common actions & buttons (`action.*`)

| Key | fr | ar | en |
|---|---|---|---|
| action.save | Enregistrer | | |
| action.cancel | Annuler | | |
| action.close | Fermer | | |
| action.ok | OK | | |
| action.create | Créer | | |
| action.add | Ajouter | | |
| action.edit | Modifier | | |
| action.delete | Supprimer | | |
| action.archive | Archiver | | |
| action.restore | Restaurer | | |
| action.retry | Réessayer | | |
| action.reload | Recharger | | |
| action.overwrite | Écraser | | |
| action.ignoreAndOverwrite | Ignorer et écraser | | |
| action.stay | Rester | | |
| action.leave | Quitter | | |
| action.back | Retour | | |
| action.backHome | Retour à l'accueil | | |
| action.previous | ← Précédent | | |
| action.continue | Continuer → | | |
| action.saveAndQuit | Enregistrer et quitter | | |
| action.apply | Appliquer | | |
| action.applyCount | Appliquer ({count}) | | |
| action.confirm | Confirmer | | |
| action.open | Ouvrir | | |
| action.openArrow | Ouvrir › | | |
| action.view | Voir | | |
| action.details | Détails | | |
| action.download | Télécharger | | |
| action.export | Exporter | | |
| action.import | Importer | | |
| action.print | Imprimer | | |
| action.printCount | Imprimer ({count}) | | |
| action.copy | Copier | | |
| action.test | Tester | | |
| action.send | Envoyer | | |
| action.resend | Renvoyer | | |
| action.resendIn | Renvoyer dans {time} | | |
| action.search | Rechercher | | |
| action.filters | Filtres | | |
| action.filtersCount | Filtres ({count}) | | |
| action.clearFilters | Effacer les filtres | | |
| action.clearAll | Effacer tout | | |
| action.selectAll | Tout sélectionner ({count}) | | |
| action.deselect | Désélectionner | | |
| action.actions | Actions | | |
| action.assign | Assigner | | |
| action.assignTo | Assigner à… | | |
| action.assignCount | Assigner ({count}) | | |
| action.assignMe | Moi | | |
| action.unassign | Personne (désassigner) | | |
| action.refresh | Actualiser | | |
| action.refreshing | Actualisation… | | |
| action.upToDate | À jour | | |
| action.reconnect | Reconnecter | | |
| action.connect | Connecter | | |
| action.disconnect | Déconnecter | | |
| action.pause | Mettre en pause | | |
| action.resume | Reprendre | | |
| action.resumeAi | Reprendre l'IA | | |
| action.pauseAi | Mettre l'IA en pause | | |
| action.resolve | Résoudre | | |
| action.markResolved | Marquer résolues | | |
| action.dismiss | Ignorer | | |
| action.block | Bloquer | | |
| action.unblock | Débloquer | | |
| action.report | Signaler | | |
| action.merge | Fusionner | | |
| action.duplicate | Dupliquer | | |
| action.upgrade | Passer à {plan} | | |
| action.comparePlans | Comparer les plans | | |
| action.choosePlan | Choisir un plan | | |
| action.renew | Renouveler | | |
| action.buyCredits | Acheter des crédits | | |
| action.buyPack | Acheter un pack | | |
| action.later | Plus tard | | |
| action.continueInBackground | Continuer en arrière-plan | | |
| action.cancelTask | Annuler la tâche | | |
| action.contactSupport | Contacter le support | | |
| action.login | Se connecter | | |
| action.keep | Garder | | |
| action.newOrder | + Nouvelle commande | | |
| action.newProduct | + Nouveau produit | | |
| action.newAgent | + Nouvel agent | | |
| action.newClient | + Nouveau | | |
| action.upload | Téléverser | | |
| action.remove | Retirer | | |
| action.revoke | Révoquer | | |
| action.replay | Rejouer | | |
| action.enable | Réactiver | | |
| action.disable | Désactiver | | |
| action.loadMore | Charger les {count} suivantes | | |
| action.markAllRead | Tout marquer comme lu | | |
| action.preferences | Préférences | | |
| action.generate | Générer | | |
| action.analyze | Analyser | | |
| action.sendToCourier | Envoyer au transporteur | | |
| action.labels | Bordereaux | | |
| action.callToConfirm | ✆ Appeler pour confirmer | | |
| action.markConfirmed | ✓ Marquer confirmée | | |
| action.scheduleReminder | ⏰ Programmer un rappel | | |
| action.openConversation | 💬 Ouvrir la conversation | | |
| action.editOrder | ✎ Modifier la commande | | |
| action.exportPrint | ⤓ Exporter / imprimer | | |
| action.cancelOrder | ✕ Annuler la commande | | |
| action.prepare | Préparer | | |
| action.markShipped | Marquer expédiée | | |
| action.markDelivered | Marquer livrée | | |
| action.markReturned | Marquer retournée | | |
| action.recordPayment | Enregistrer un paiement | | |
| action.paymentLink | Lien de paiement | | |
| action.refund | Rembourser | | |
| action.editAddress | Modifier l'adresse de livraison | | |
| action.retryDelivery | Relancer la livraison | | |
| action.fixAddressAndRetry | Corriger l'adresse → relancer | | |
| action.callClient | Appeler {phone} | | |
| action.courierPortal | Portail {courier} ↗ | | |
| action.cancelParcel | Annuler le colis | | |
| action.adjustStock | Ajuster le stock | | |
| action.quickEdit | Édition rapide | | |
| action.addToAgent | Ajouter à un agent | | |
| action.bulkPrice | Prix en masse | | |
| action.bulkCategory | Catégorie en masse | | |
| action.insights | Insights | | |
| action.playground | Bac à essai | | |
| action.configure | Configurer | | |
| action.regenerate | Régénérer | | |
| action.inbox | Boîte | | |
| action.stock | Stock | | |

### 2.3 Common labels (`common.*`)

| Key | fr | ar | en |
|---|---|---|---|
| common.yes | Oui | | |
| common.no | Non | | |
| common.all | Toutes | | |
| common.allM | Tous | | |
| common.none | Aucun | | |
| common.today | Aujourd'hui | | |
| common.yesterday | Hier | | |
| common.ago | il y a {time} | | |
| common.daysAgo | il y a {count} j | | |
| common.default | DÉFAUT | | |
| common.required | obligatoire | | |
| common.optional | facultatif | | |
| common.loading | Chargement… | | |
| common.saving | Enregistrement… | | |
| common.sending | Envoi… | | |
| common.verifying | Vérification… | | |
| common.connecting | Connexion… | | |
| common.analyzing | Analyse… | | |
| common.perPage | {count} / page | | |
| common.pageOf | {page} / {pages} | | |
| common.rangeOf | {from}–{to} sur {total} | | |
| common.selectedCount | {count} sélectionnées | | |
| common.density | DENSITÉ | | |
| common.columns | COLONNES | | |
| common.period | Période : {label} | | |
| common.period.today | Aujourd'hui | | |
| common.period.7d | 7 j | | |
| common.period.30d | 30 j | | |
| common.period.90d | 90 j | | |
| common.period.month | Ce mois | | |
| common.period.lastMonth | Mois dernier | | |
| common.period.year | Cette année | | |
| common.period.custom | Personnalisé | | |
| common.from | Du | | |
| common.to | Au | | |
| common.currency | DA | | |
| common.amount | {amount} DA | | |
| common.credits | crédits | | |
| common.destructive | DESTRUCTIF | | |
| common.typeToConfirm | TAPEZ LE NUMÉRO POUR CONFIRMER | | |
| common.typeNameToConfirm | TAPEZ LE NOM POUR CONFIRMER | | |
| common.mustMatch | doit correspondre exactement | | |
| common.reason | MOTIF | | |
| common.reasonRequired | MOTIF (OBLIGATOIRE) | | |
| common.note | NOTE | | |
| common.noteOptional | NOTE (FACULTATIF) | | |
| common.name | NOM | | |
| common.phone | TÉLÉPHONE | | |
| common.phone2 | TÉLÉPHONE 2 (FACULTATIF) | | |
| common.email | E-MAIL | | |
| common.password | MOT DE PASSE | | |
| common.wilaya | WILAYA | | |
| common.commune | COMMUNE | | |
| common.address | ADRESSE | | |
| common.home | Domicile | | |
| common.stopdesk | Stop-desk | | |
| common.tags | TAGS | | |
| common.total | TOTAL | | |
| common.subtotal | Sous-total | | |
| common.deliveryFee | Frais de livraison | | |
| common.discount | Remise | | |
| common.paid | Payé | | |
| common.remaining | Reste | | |
| common.quantity | QUANTITÉ | | |
| common.price | PRIX | | |
| common.date | DATE | | |
| common.status | STATUT | | |
| common.source | SOURCE | | |
| common.client | CLIENT | | |
| common.courier | TRANSPORTEUR | | |
| common.tracking | SUIVI | | |
| common.risk | RISQUE | | |
| common.items | ARTICLES | | |
| common.itemsMore | + {count} article(s) | | |
| common.new | nouveau | | |
| common.ordersCount | {count} cmd | | |
| common.returnsCount | {count} retour(s) | | |
| common.shortcut.enter | Enter | | |
| common.shortcut.del | Del | | |

### 2.4 Status pills (`enum.*`) — frame `REF — Component sheet`

Every enum value of `prisma-schema.prisma` has a key `enum.<Model>.<field>.<value>`; values not listed here get the literal French translation in sentence case, ar/en literal. `pnpm i18n:check` generates the missing keys from the schema and fails when a value has no translation.

| Key | fr | ar | en |
|---|---|---|---|
| enum.Order.status.new | NOUVELLE | | |
| enum.Order.status.confirmed | CONFIRMÉE | | |
| enum.Order.status.preparing | EN PRÉPARATION | | |
| enum.Order.status.shipped | EXPÉDIÉE | | |
| enum.Order.status.delivered | LIVRÉE | | |
| enum.Order.status.returned | RETOURNÉE | | |
| enum.Order.status.cancelled | ANNULÉE | | |
| enum.Order.confirmationStatus.pending | À APPELER | | |
| enum.Order.confirmationStatus.no_answer | SANS RÉPONSE {attempts}/3 | | |
| enum.Order.confirmationStatus.confirmed | CONFIRMÉE | | |
| enum.Order.confirmationStatus.rejected | REFUS | | |
| enum.Order.confirmationStatus.callback | RAPPEL {time} | | |
| enum.Order.confirmationStatus.wrong_number | FAUX NUMÉRO | | |
| enum.Order.cancelReason.unreachable | Client injoignable | | |
| enum.Order.cancelReason.changed_mind | Client a changé d'avis | | |
| enum.Order.cancelReason.fake | Faux numéro / commande blague | | |
| enum.Order.cancelReason.unavailable | Produit indisponible | | |
| enum.Order.cancelReason.duplicate | Doublon | | |
| enum.Order.cancelReason.other | Autre | | |
| enum.Order.paymentStatus.unpaid | NON PAYÉE | | |
| enum.Order.paymentStatus.partial | PARTIELLE | | |
| enum.Order.paymentStatus.paid | PAYÉE | | |
| enum.Order.paymentStatus.pending_link | LIEN EN ATTENTE | | |
| enum.Order.paymentStatus.refunded | REMBOURSÉE | | |
| enum.Order.paymentMethod.cash | COD | | |
| enum.Order.paymentMethod.card | CIB | | |
| enum.Order.paymentMethod.transfer | Virement | | |
| enum.Order.paymentMethod.ccp | CCP | | |
| enum.Order.paymentMethod.other | Autre | | |
| enum.Order.source.ai | ✦ IA | | |
| enum.Order.source.manual | ✎ MANUEL | | |
| enum.Order.source.mobile | ▣ MOBILE | | |
| enum.Order.source.api | { } API | | |
| enum.Order.source.import | ⤒ IMPORT | | |
| enum.Client.riskLevel.normal | FIABLE | | |
| common.risk.unknown | INCONNU | | |
| enum.Client.riskLevel.high | RISQUE | | |
| enum.Client.blocked | BLOQUÉ | | |
| enum.Client.placeholder | À compléter | بحاجة إلى إكمال | To complete |
| enum.Order.deliveryStatus.not_sent | NON ENVOYÉE | | |
| enum.Order.deliveryStatus.pending | À ENVOYER | | |
| enum.Shipment.status.pending | ENVOI EN COURS | | |
| enum.Shipment.status.sent | CRÉÉE | | |
| enum.Shipment.status.picked_up | RAMASSÉE | | |
| enum.Shipment.status.in_transit | EN TRANSIT | | |
| enum.Shipment.status.out_for_delivery | EN LIVRAISON | | |
| enum.Shipment.status.delivered | LIVRÉE ✓ | | |
| enum.Shipment.status.failed | ÉCHEC | | |
| enum.Shipment.status.returned | RETOURNÉE | | |
| enum.Shipment.status.cancelled | ANNULÉE | | |
| enum.Shipment.status.stale | SANS MOUVEMENT | | |
| enum.Shipment.failureReason.address | ADRESSE | | |
| enum.Shipment.failureReason.unreachable | INJOIGNABLE | | |
| enum.Shipment.failureReason.refused | REFUSÉ | | |
| enum.Shipment.failureReason.damaged | ENDOMMAGÉ | | |
| enum.Shipment.failureReason.other | AUTRE | | |
| enum.Courier.zrexpress | ZR EXPRESS | | |
| enum.Courier.ecotrack | ECOTRACK | | |
| enum.Courier.yalidine | YALIDINE | | |
| enum.Courier.manual | LIVRAISON PROPRE | | |
| enum.Courier.test.ok | TEST OK | | |
| enum.Courier.test.invalid | IDENTIFIANTS INVALIDES | | |
| enum.Product.state.active | ACTIF | | |
| enum.Product.state.hidden | MASQUÉ | | |
| enum.Product.state.archived | ARCHIVÉ | | |
| enum.Product.state.service | SERVICE | | |
| enum.Product.stock.low | STOCK FAIBLE | | |
| enum.Product.stock.out | RUPTURE | | |
| enum.Product.moderationStatus.approved | VALIDÉ | | |
| enum.Product.moderationStatus.pending | EN ATTENTE | | |
| enum.Product.moderationStatus.rejected | REFUSÉ | | |
| enum.Product.moderationStatus.appealed | CONTESTATION | | |
| enum.Product.ai.proposed | PROPOSÉ PAR L'IA | | |
| enum.Product.ai.excluded | EXCLU DE L'IA | | |
| enum.StockMovement.type.in | ENTRÉE | | |
| enum.StockMovement.type.out | SORTIE | | |
| enum.StockMovement.type.adjustment_in | AJUST. + | | |
| enum.StockMovement.type.adjustment_out | AJUST. − | | |
| enum.StockMovement.type.inventory | INVENTAIRE | | |
| enum.StockMovement.type.return | RETOUR | | |
| enum.Conversation.author.ai | IA | | |
| enum.Conversation.status.needs_human | À TRAITER | | |
| enum.Conversation.assigned | ASSIGNÉE | | |
| enum.Conversation.aiPaused | IA EN PAUSE | | |
| enum.Conversation.status.resolved | RÉSOLUE | | |
| enum.Conversation.status.archived | ARCHIVÉE | | |
| enum.Conversation.outsideWindow | HORS FENÊTRE 24 H | | |
| enum.Agent.status.active | ACTIF | | |
| enum.Agent.status.paused | EN PAUSE | | |
| enum.Agent.status.draft | BROUILLON | | |
| enum.Agent.pausedReason.plan | PAUSE (PLAN) | | |
| enum.Agent.version.current | V{n} · ACTUELLE | | |
| enum.Agent.presetUpdateAvailable | MAJ PRÉRÉGLAGE DISPO | | |
| enum.Channel.platform.facebook | FACEBOOK | | |
| enum.Channel.platform.instagram | INSTAGRAM | | |
| enum.Channel.status.active | ACTIVE | | |
| enum.Channel.status.pending_review | EN ATTENTE META | | |
| enum.Channel.status.needs_reconnect | RECONNEXION REQUISE | | |
| enum.Channel.status.paused | EN PAUSE (PLAN) | | |
| enum.Channel.status.disabled | DÉSACTIVÉ | | |
| enum.Channel.status.disconnected | DÉCONNECTÉ | | |
| enum.AgentInsight.type.unclear | INCOMPRÉHENSION | | |
| enum.AgentInsight.type.unknown_topic | SUJET INCONNU | | |
| enum.AgentInsight.type.handoff | TRANSFERT | | |
| enum.AgentInsight.type.error | ERREUR IA | | |
| enum.Subscription.status.trial | ESSAI | | |
| enum.Subscription.status.active | ACTIF | | |
| enum.Subscription.status.expired | EXPIRÉ | | |
| enum.Subscription.status.cancelled | RÉSILIÉ | | |
| enum.Subscription.status.dunning | RELANCE | | |
| enum.Subscription.dunningStage.d_minus_7 | RELANCE J−7 | | |
| enum.Subscription.dunningStage.d0 | RELANCE J0 | | |
| enum.Subscription.dunningStage.d_plus_3 | RELANCE J+3 | | |
| enum.Subscription.dunningStage.expired | EXPIRÉ | | |
| enum.Workspace.status.active | ACTIF | | |
| enum.Workspace.status.suspended | SUSPENDU | | |
| enum.Workspace.status.deletion_scheduled | SUPPRESSION J+30 | | |
| enum.Invoice.status.unpaid | IMPAYÉE | | |
| enum.Invoice.status.paid | PAYÉE | | |
| enum.Invoice.status.upcoming | À VENIR | | |
| enum.Credits.pill | CRÉDITS {used} / {limit} | | |
| enum.Credits.80 | CRÉDITS 80 % | | |
| enum.Credits.exhausted | ÉPUISÉS | | |
| enum.Credits.pack | PACK | | |
| enum.Job.status.running | EN COURS · {pct} % | | |
| enum.Job.status.done | PRÊT | | |
| enum.Job.status.partial | PARTIEL | | |
| enum.Job.status.failed | ÉCHEC | | |
| enum.Admin.deletionScheduled | SUPPRESSION J+30 | | |
| enum.Admin.unverified | NON VÉRIFIÉ | | |
| enum.Admin.urgent | URGENT | | |
| enum.Admin.autoApproved | AUTO-APPROUVÉ | | |
| enum.Admin.appeal | APPEL | | |
| enum.Admin.slaBreached | SLA DÉPASSÉ | | |
| enum.Admin.waitingCustomer | EN ATTENTE CLIENT | | |
| enum.Admin.trust.watch | TRUST · SURVEILLANCE | | |
| enum.Workspace.trustLevel.new | NOUVEAU | | |
| enum.Workspace.trustLevel.standard | STANDARD | | |
| enum.Workspace.trustLevel.trusted | TRUSTED | | |
| enum.Workspace.trustLevel.watch | SURVEILLANCE | | |
| enum.Membership.role.owner | Propriétaire | | |
| enum.Membership.role.admin | Admin | | |
| enum.Membership.role.operator | Opérateur | | |
| enum.Membership.readOnly | Lecture seule | | |
| enum.PlatformRole.super_admin | Super admin | | |
| enum.PlatformRole.support | Support | | |
| enum.PlatformRole.moderator | Modérateur | | |
| enum.PlatformRole.finance | Finance | | |
| enum.PlatformRole.read | Lecture | | |

### 2.5 Global states (`state.*`) — frame `GLOBAL — States, toasts, banners & system dialogs catalogue`

| Key | fr | ar | en |
|---|---|---|---|
| state.list.empty.orders.title | Aucune commande | | |
| state.list.empty.orders.description | Les commandes créées par l'IA ou votre équipe apparaîtront ici. | | |
| state.list.filteredEmpty.title | Aucun résultat | | |
| state.list.filteredEmpty.description | Aucun(e) {entity} ne correspond à « {filters} ». | | |
| state.list.error.title | Impossible de charger | | |
| state.list.error.description | Une erreur est survenue (ref. {ref}). | | |
| state.list.error.adminDetails | Détails pour les admins ▸ | | |
| state.offline.banner | Hors ligne — données du {date}. Les actions sont désactivées jusqu'au retour de la connexion. | | |
| state.list.loadMore | {count} de plus | | |
| state.form.validationSummary | Validation : {count} erreurs — {list} | | |
| state.form.leave.title | Quitter sans enregistrer ? | | |
| state.form.leave.description | Vous avez des modifications non enregistrées sur « {name} ». | | |
| state.form.conflict.title | Modifié par quelqu'un d'autre | | |
| state.form.conflict.description | Modifié par {name} il y a {ago} · votre brouillon est conservé. | | |
| state.form.conflict.descriptionLong | {name} a modifié cet élément il y a {ago} ({change}). Vos modifications non enregistrées sont conservées dans le formulaire. | | |
| state.form.saved | Enregistré | | |
| state.detail.notFound.title | Introuvable | | |
| state.detail.notFound.description | Cet élément n'existe pas ou appartient à un autre espace. | | |
| state.detail.deleted.title | Supprimée | | |
| state.detail.deleted.description | Supprimée le {date} par {name} · restaurable par un admin pendant 30 j. | | |
| state.detail.forbidden.title | Accès refusé | | |
| state.detail.forbidden.description | Votre rôle ({role}) ne permet pas de voir {section}. Demandez à un admin. | | |
| state.page.403.title | 403 | | |
| state.page.403.description | Cette page est réservée aux admins de l'espace. Votre rôle : {role}. | | |
| state.page.404.title | Introuvable ou accès refusé | | |
| state.page.suspended.title | Espace suspendu | | |
| state.page.suspended.description | « {reason} » · Vos données sont conservées. Contactez le support pour lever la suspension. | | |
| state.page.sessionExpired.title | Session expirée | | |
| state.page.sessionExpired.description | Reconnectez-vous pour continuer. Vous reviendrez sur {path}. | | |
| state.queue.empty.title | Tout est calme | | |
| state.queue.empty.description | Aucune conversation n'attend un humain. Les insights apparaissent ici. | | |
| state.thread.empty | Aucun message pour l'instant | | |
| state.ws.reconnecting | reconnexion… | | |

### 2.6 Toasts (`toast.*`)

| Key | fr | ar | en |
|---|---|---|---|
| toast.order.confirmed | Commande #{number} confirmée | | |
| toast.forbidden | Action non autorisée pour votre rôle | | |
| toast.providerUnavailable | Le fournisseur IA ne répond pas | | |
| toast.metaUnavailable | Meta est momentanément indisponible — nouvel essai automatique | | |
| toast.badRequest | Requête invalide — réf. {ref} | | |
| toast.export.progress | Export des {entity} : {pct} % ({rows} lignes) | | |
| toast.export.done | Export terminé · {file} | | |
| toast.planNearLimit | Vous approchez de la limite : {current} / {limit} {resource} | | |
| toast.saved | Enregistré | | |
| toast.copied | Copié | | |
| toast.jobStarted | Tâche lancée · vous serez notifié à la fin | | |
| toast.connectionCancelled | Connexion annulée | | |
| toast.noConnection | Pas de connexion | | |

### 2.7 Banners (`banner.*`)

| Key | fr | ar | en |
|---|---|---|---|
| banner.credits100 | Crédits épuisés ({used} / {limit}) — l'IA ne répond plus. Rechargez ou attendez le {date}. | | |
| banner.credits80 | 80 % des crédits utilisés ({used} / {limit}). À ce rythme, épuisés le {date}. | | |
| banner.planExpiring | Votre plan {plan} expire dans {days} jours ({date}). Renouvelez pour garder vos {pages} pages et {agents} agents. | | |
| banner.planExpired | Plan expiré le {date} — limites du plan gratuit appliquées ({pages} page, {agents} agent). Tout redevient actif dès le renouvellement. | | |
| banner.reconnect | Page « {page} » : jeton Meta expiré. L'IA ne répond plus sur cette page. | | |
| banner.approvalPending | Instagram {account} en attente d'approbation Meta — activation automatique à l'approbation. | | |
| banner.readOnly | Lecture seule — votre accès est limité (READ_ONLY_MEMBER : plan à la limite des membres). Demandez à un admin. | | |
| banner.emailUnverified | Vérifiez votre e-mail pour connecter une page. | | |
| banner.newVersion.title | Nouvelle version disponible | | |
| banner.newVersion.description | Rechargez pour obtenir la dernière version de Djaber (web). Vos brouillons sont conservés. | | |
| banner.suspended | Espace suspendu — contactez le support. | | |
| banner.offline | Pas de connexion | | |
| banner.moderation.rejected | {count} produit refusé : « {name} » — {reason}. Modifiez-le et resoumettez, ou contestez une fois sous 7 jours. | | |
| banner.moderation.pending | {count} produits en attente de validation | | |
| banner.negativeCredits | Solde de crédits négatif (remboursement store) — l'IA est bloquée jusqu'à régularisation. | | |

### 2.8 System dialogs (`dialog.*`)

| Key | fr | ar | en |
|---|---|---|---|
| dialog.planLimit.title | Limite du plan atteinte | | |
| dialog.planLimit.description | Limite du plan atteinte · {current} / {limit} {resource} sur {plan}. Passez à {nextPlan} pour en connecter plus. | | |
| dialog.emailUnverified.title | Vérifiez votre e-mail | | |
| dialog.emailUnverified.description | Cette action nécessite un e-mail vérifié. Lien envoyé à {email}. | | |
| dialog.jobRunning.title | Tâche en cours | | |
| dialog.jobRunning.description | {label} · {pct} % · vous pouvez quitter cette page, une notification vous préviendra. | | |
| dialog.delete.title | Supprimer {name} ? | | |
| dialog.cancelOrder.title | Annuler la commande #{number} | | |
| dialog.changeStatus.title | Changer le statut | | |
| dialog.assign.title | Assigner | | |
| dialog.reminder.title | Programmer un rappel | | |
| dialog.markDelivered.title | Marquer livrée manuellement | | |
| dialog.markReturned.title | Marquer retournée | | |
| dialog.printLabels.title | Imprimer les bordereaux | | |
| dialog.exportOrders.title | Exporter les commandes | | |
| dialog.editAddress.title | Modifier l'adresse de livraison | | |
| dialog.callResult.title | Résultat de l'appel | | |
| dialog.mergeClients.title | Fusionner les clients | | |
| dialog.recordPayment.title | Enregistrer un paiement | | |
| dialog.deleteOrder.title | Supprimer la commande #{number} | | |
| dialog.paymentLink.title | Lien de paiement | | |
| dialog.refund.title | Rembourser | | |
| dialog.addCourier.title | Ajouter un transporteur | | |
| dialog.deleteCourier.title | Supprimer le transporteur {name} ? | | |
| dialog.labelUnavailable.title | Bordereau indisponible | | |
| dialog.cancelParcel.title | Annuler le colis | | |
| dialog.newClient.title | Nouveau client | | |
| dialog.deleteClient.title | Supprimer le client « {name} » ? | | |
| dialog.tags.title | Tags | | |
| dialog.newCategory.title | Nouvelle catégorie | | |
| dialog.newUnit.title | Nouvelle unité | | |
| dialog.deleteProduct.title | Supprimer « {name} » ? | | |
| dialog.bulkPrice.title | Modifier les prix en masse | | |
| dialog.changeCategory.title | Changer la catégorie | | |
| dialog.generateVariants.title | Générer des variantes | | |
| dialog.duplicateProduct.title | Dupliquer le produit | | |
| dialog.newSupplier.title | Nouveau fournisseur | | |
| dialog.supplierPayment.title | Enregistrer un paiement fournisseur | | |
| dialog.cancelSale.title | Annuler la vente #{number} | | |
| dialog.collectRemaining.title | Encaisser le reste | | |
| dialog.cashEntry.title | Mouvement de caisse manuel | | |
| dialog.startInventory.title | Lancer un inventaire | | |
| dialog.validateInventory.title | Valider l'inventaire #{number} | | |
| dialog.columnMapping.title | Correspondance des colonnes | | |
| dialog.fromPhoto.title | Créer depuis une photo | | |
| dialog.adjustStock.title | Ajuster le stock | | |
| dialog.deleteCategory.title | Supprimer la catégorie « {name} » ? | | |
| dialog.productExpense.title | Dépense produit | | |
| dialog.recommendationRule.title | Règle de recommandation | | |
| dialog.restoreProduct.title | Restaurer « {name} » | | |
| dialog.deleteAgent.title | Supprimer l'agent « {name} » ? | | |
| dialog.pauseAgent.title | Mettre en pause « {name} » | | |
| dialog.resolveInsight.title | Résoudre l'insight | | |
| dialog.disconnectChannel.title | Déconnecter « {name} » ? | | |
| dialog.resumeSwap.title | Réactiver « {name} » | | |
| dialog.connectReport.title | Rapport de connexion | | |
| dialog.connectExplainer.title | Connecter une page | | |
| dialog.syncHistory.title | Synchroniser l'historique | | |
| dialog.modelUnavailable.title | Modèle IA indisponible | | |
| dialog.generateAgent.title | Générer un agent depuis ma page | | |
| dialog.deleteConversation.title | Supprimer la conversation ? | | |
| dialog.blockCustomer.title | Bloquer ce client | | |
| dialog.reportCustomer.title | Signaler à Djaber — {name} | | |
| dialog.enable2fa.title | Activer la double authentification | | |
| dialog.disable2fa.title | Désactiver la 2FA / Régénérer les codes | | |
| dialog.changePassword.title | Changer le mot de passe | | |
| dialog.changeEmail.title | Changer l'e-mail | | |
| dialog.deleteAccount.title | Supprimer mon compte | | |
| dialog.logo.title | Logo de l'espace & avatar | | |
| dialog.quickReply.title | Réponse rapide | | |
| dialog.resetSystemMessage.title | Message système — réinitialiser | | |
| dialog.deleteWorkspace.title | Supprimer l'espace « {name} » | | |
| dialog.sheetsPick.title | Google Sheets — choisir la feuille | | |
| dialog.webhook.title | Webhook sortant | | |
| dialog.changePlan.title | Changer de plan | | |
| dialog.creditCalculator.title | Calculateur de crédits | | |
| dialog.inviteMember.title | Inviter un membre | | |
| dialog.transferOwnership.title | Transférer la propriété | | |
| dialog.language.title | Langue & région | | |
| dialog.shortcuts.title | Raccourcis clavier | | |

### 2.9 Keyboard shortcuts help (`shortcuts.*`)

| Key | fr | ar | en |
|---|---|---|---|
| shortcuts.enterShiftEnter | Entrée / Maj+Entrée | | |
| shortcuts.enterShiftEnter.desc | envoyer / nouvelle ligne (composer) | | |
| shortcuts.esc.desc | fermer dialogue / panneau | | |
| shortcuts.arrows.desc | fiche précédente / suivante (panneau latéral) | | |
| shortcuts.slash.desc | réponses rapides | | |
| shortcuts.rowActions.desc | actions de ligne (Commandes) | | |
| shortcuts.ctrlK.desc | recherche de la liste courante (focus) | | |
| shortcuts.help.desc | cette aide | | |

### 2.10 Notifications (`notification.*`) — frame `NTF-01 — Notifications — list`

| Key | fr | ar | en |
|---|---|---|---|
| notification.filter.all | Toutes | | |
| notification.filter.unread | Non lues {count} | | |
| notification.filter.aiOrders | Commandes IA | | |
| notification.filter.needsHuman | À traiter | | |
| notification.filter.aiIssues | Problèmes IA | | |
| notification.filter.stock | Stock | | |
| notification.filter.shipments | Colis | | |
| notification.filter.payments | Paiements | | |
| notification.filter.channels | Pages | | |
| notification.filter.credits | Crédits & plan | | |
| notification.filter.members | Membres | | |
| notification.filter.integrations | Intégrations | | |
| notification.filter.jobs | Tâches | | |
| notification.unreadServer | {count} non lues · comptage serveur | | |

One `notification.<slug>.title` key per value of the Prisma enum `NotificationType` (56 rows, in enum order; slug = enum value with `_` → `.` after the first segment, as in 03 §15). `.body` keys exist where listed; a type without a `.body` row renders the title only. Params come from the notification `data` JSON (03-events §5.1).

| Key | fr | ar | en |
|---|---|---|---|
| notification.order.ai_created.title | Nouvelle commande #{number} · {total} DA | | |
| notification.order.ai_created.body | {agent} a créé une commande pour {client} ({channel}). | | |
| notification.conversation.handoff.title | Conversation à traiter — {client} | | |
| notification.conversation.handoff.body | Motif : {reason} | | |
| notification.conversation.needs_human_message.title | {client} a répondu dans une conversation en attente | | |
| notification.conversation.needs_human_message.body | « {preview} » — l'IA est en pause. | | |
| notification.conversation.handoff_unattended.title | Conversation sans réponse depuis {minutes} min | | |
| notification.agent.insight.title | Nouvel insight pour {agent} : {type} | | |
| notification.ai.error.title | Fournisseur IA indisponible ({failures} échecs en 10 min) | | |
| notification.ai.error.body | Les conversations concernées sont en file d'attente pour un humain. | | |
| notification.stock.low.title | Stock faible : {product} ({stock} restants) | | |
| notification.stock.low.body | Seuil : {min}. Une seule alerte par jour et par produit. | | |
| notification.stock.out.title | Rupture : {product} | | |
| notification.shipment.created.title | Colis créé #{number} · {tracking} | | |
| notification.shipment.out_for_delivery.title | En livraison #{number} | | |
| notification.shipment.delivered.title | Livrée #{number} | | |
| notification.shipment.failed.title | Échec de livraison #{number} | | |
| notification.shipment.failed.body | {courier} : {reason}. Corrigez et renvoyez, ou marquez retournée. | | |
| notification.shipment.returned.title | Retour en cours #{number} | | |
| notification.payment.received.title | Paiement reçu #{number} | | |
| notification.payment.failed.title | Paiement échoué #{number} | | |
| notification.channel.needs_reconnect.title | {page} : page déconnectée par Meta | | |
| notification.channel.needs_reconnect.body | Jeton révoqué. L'IA ne répond plus sur cette page jusqu'à reconnexion. | | |
| notification.channel.paused_by_plan.title | Page « {page} » en pause (limite du plan) | | |
| notification.credits.80.title | 80 % des crédits utilisés | | |
| notification.credits.80.body | {used} / {limit} crédits consommés ce mois. À 100 %, l'IA s'arrête. | | |
| notification.credits.exhausted.title | Crédits épuisés | | |
| notification.quota.80.title | 80 % des conversations du mois utilisées | | |
| notification.quota.100.title | Quota de conversations atteint — l'IA ne répond plus | | |
| notification.subscription.expiring.title | Votre plan expire le {date} | | |
| notification.subscription.expired.title | Plan expiré — limites du plan gratuit appliquées | | |
| notification.member.invited.title | Invitation envoyée à {email} | | |
| notification.member.joined.title | {name} a rejoint l'espace en tant que {role} | | |
| notification.account.verify_reminder.title | Vérifiez votre e-mail pour connecter une page | | |
| notification.workspace.deleted.title | Espace « {name} » supprimé définitivement | | |
| notification.sheets.error.title | Google Sheets : erreur de synchronisation | | |
| notification.webhook.disabled.title | Webhook désactivé après 50 échecs | | |
| notification.job.finished.title | Tâche terminée : {label} | | |
| notification.job.finished.import.title | Import terminé : {imported} produits importés, {skipped} lignes ignorées | | |
| notification.job.finished.import.body | Téléchargez le rapport d'erreurs pour corriger les {skipped} lignes. | | |
| notification.order.callback_due.title | Rappel : appeler {client} pour #{number} | | |
| notification.order.status_changed.title | Commande #{number} : {from} → {to} | | |
| notification.order.assigned.title | Commande #{number} vous est assignée | | |
| notification.conversation.assigned.title | Conversation avec {client} vous est assignée | | |
| notification.channel.approved.title | {page} : approbation Meta reçue, page active | | |
| notification.product.approved.title | {count} produits validés aujourd'hui | | |
| notification.product.rejected.title | Produit refusé : {name} | | |
| notification.product.changes_requested.title | Modifications demandées : {name} | | |
| notification.moderation.appeal_result.title | Contestation {decision} : {name} | | |
| notification.report.resolved.title | Signalement traité : {decision} | | |
| notification.customer.auto_blocked.title | Client {client} bloqué automatiquement ({rule}) | | |
| notification.support.reply.title | Réponse du support · #{ticket} | | |
| notification.credits.pack_purchased.title | Pack de {credits} crédits ajouté | | |
| notification.credits.negative.title | Solde de crédits négatif — l'IA est bloquée | | |
| notification.invoice.unpaid.title | Facture {number} impayée — {amount} DA | | |
| notification.workspace.suspended.title | Espace suspendu : {reason} | | |
| notification.workspace.reactivated.title | Espace réactivé | | |
| notification.workspace.deletion_scheduled.title | Suppression de l'espace programmée le {date} | | |
| notification.account.deletion_confirmed.title | Suppression de votre compte confirmée — effective le {date} | | |
| notification.member.role_changed.title | Votre rôle est maintenant {role} | | |
| notification.agent.preset_update_available.title | Nouvelle version du préréglage pour {agent} | | |
| notification.app.update_required.title | Mise à jour requise ({minVersion}) | | |
| notification.app.update_recommended.title | Nouvelle version disponible ({version}) | | |
| notification.legal.reacceptance_required.title | Conditions mises à jour — acceptation requise | | |
| notification.platform.announcement.title | {title} | | |
| notification.job.failed.title | Tâche échouée : {label} | | |

### 2.11 Customer system messages (`customer.*`) — 11 §9 (R-G)

**Workspace-editable (4 keys)** — defaults seeded into `Workspace.systemMessages` at creation (`{ handoff, out_of_hours, out_of_stock, welcome } × { fr, ar, en }`), editable in Settings › Messages système (preview, "Réinitialiser"); the i18n key holds the default.

| Key | fr | ar | en |
|---|---|---|---|
| customer.handoff | Je transmets à un membre de l'équipe qui vous répondra très vite. | سأحوّلك إلى أحد أفراد الفريق ليرد عليك قريبًا. | I'm passing this to a team member who will reply shortly. |
| customer.out_of_hours | Notre équipe est absente pour le moment, je prends votre commande en attendant et nous vous rappelons dès l'ouverture. | فريقنا غير متاح حاليًا، سأسجّل طلبك في الأثناء وسنتصل بك عند الفتح. | Our team is away right now; I'll take your order meanwhile and we'll call you back at opening. |
| customer.out_of_stock | Désolé, {product} est en rupture de stock pour le moment. | عذرًا، {product} غير متوفر حاليًا. | Sorry, {product} is out of stock right now. |
| customer.welcome | Bonjour 👋 Bienvenue chez {shop} ! Comment puis-je vous aider ? | مرحبًا 👋 أهلًا بك في {shop}! كيف يمكنني مساعدتك؟ | Hello 👋 Welcome to {shop}! How can I help you? |

**Fixed platform texts** (not workspace-editable; sent in the situations of 11 §9 / 04 §1):

| Key | fr | ar | en |
|---|---|---|---|
| customer.unavailable | Désolé, notre assistant est momentanément indisponible. Un membre de l'équipe vous répondra bientôt. 🙏 | عذرًا، المساعد غير متاح حاليًا. سيرد عليك أحد أفراد الفريق قريبًا. 🙏 | Sorry, our assistant is temporarily unavailable. A team member will reply soon. 🙏 |
| customer.unsupportedMedia | Je ne peux pas lire ce type de message. Envoyez-moi un texte ou une photo 😊 | لا أستطيع قراءة هذا النوع من الرسائل. أرسل نصًا أو صورة 😊 | I can't read this type of message. Please send text or a photo 😊 |
| customer.voiceFailed | Je n'ai pas réussi à écouter votre vocal, pouvez-vous l'écrire ? | لم أتمكن من سماع رسالتك الصوتية، هل يمكنك كتابتها؟ | I couldn't hear your voice note, could you type it? |
| customer.outsideWindowSkipped (thread label, never sent) | Non délivré — hors fenêtre 24 h | غير مُسلَّم — خارج نافذة 24 ساعة | Not delivered — outside the 24 h window |

**Order templates** (transactional messages, MSG-06; `templateKey` of `POST /conversations/:id/messages { templateKey }` = the key suffix):

| Key | fr | ar | en |
|---|---|---|---|
| customer.orderConfirmed | Votre commande #{number} est confirmée ✓ Nous vous appelons pour confirmer la livraison. | | |
| customer.orderShipped | Votre commande #{number} est en route · suivi {tracking} ({courier}). | | |
| customer.orderOutForDelivery | Votre colis #{number} est en cours de livraison aujourd'hui. | | |
| customer.orderDelivered | Votre commande #{number} a été livrée. Merci ! | | |
| customer.orderFailed | La livraison de #{number} n'a pas abouti ({reason}). Nous vous recontactons. | | |
| customer.orderCancelled | Votre commande #{number} a été annulée. | | |
| customer.paymentLink | Payez votre commande #{number} en ligne ({total} DA) : {url} — valable {minutes} min. | | |
| customer.paymentReceived | Paiement reçu pour #{number}. Merci ! | | |
| customer.paymentFailed | Le paiement de la commande #{number} n'a pas abouti. Répondez « lien » pour recevoir un nouveau lien, ou payez à la livraison. | لم يكتمل دفع الطلب #{number}. أرسل « رابط » لتلقي رابط جديد، أو ادفع عند الاستلام. | The payment for order #{number} did not go through. Reply "link" to get a new link, or pay on delivery. |
| customer.reminderScheduled | Nous vous rappelons à {time}. | | |

### 2.12 Validation (`validation.*`) — 04 §2

| Key | fr | ar | en |
|---|---|---|---|
| validation.required | Champ requis | | |
| validation.name | 3 à 80 caractères, au moins 2 lettres | | |
| validation.phone | Numéro invalide (ex. 0555123456) | | |
| validation.phone_taken | Numéro déjà utilisé par {clientName} | | |
| validation.wilaya | Wilaya invalide | | |
| validation.commune | Commune hors de la wilaya | | |
| validation.address | Adresse requise (10 caractères min) | | |
| validation.email | E-mail invalide | | |
| validation.price | Prix de vente requis (> 0) | | |
| validation.quantity | Quantité invalide | | |
| validation.sku_taken | SKU déjà utilisé | | |
| validation.length | Trop long ({max} max) | | |
| validation.range | Valeur hors limites ({min}–{max}) | | |
| validation.date | Date dans le futur (max +1 jour) | | |
| validation.password | 8 caractères min, lettre et chiffre | | |
| validation.passwordMismatch | Ne correspond pas | | |
| validation.url_https | HTTPS obligatoire | | |

### 2.13 Error messages (`error.<CODE>`)
All codes of `11-error-catalogue.md` §1–§12 with their fr/ar/en columns are imported verbatim into `messages.*.json` under `error.<CODE>` (script `pnpm i18n:import-errors` reads the markdown tables). No error code is defined in this deck (§5).

---

## 3. Page-specific copy

Not extracted here. For each route, copy the FR strings from the Figma frame named in `02-next-route-map.md` into `<screen>.*` keys (`orders.list.kpi.toConfirm = "à confirmer"`, …). Rule: one key per distinct string; reuse `action.*`/`common.*` when the string already exists there.

---

## 4. Figma pill ↔ data mapping (so the coder never invents enum values)

| Figma pill | Data |
|---|---|
| `SANS RÉPONSE n/3` | `confirmationStatus='no_answer'` + `callAttempts` |
| `RAPPEL 16:00` | `confirmationStatus='callback'` + `Order.callbackAt` |
| `FAUX NUMÉRO` | `confirmationStatus='wrong_number'` (order auto-cancelled with `cancelReason='fake'` when not sent) |
| `REFUS` | `confirmationStatus='rejected'` |
| `COD` / `CIB` | `paymentMethod='cash'` / `'card'` (+ `OrderPayment.provider` when online) |
| `INCONNU` (risk) | `Client.riskLevel='normal'` and `orderCount=0` (display only) |
| `FIABLE` | `riskLevel='normal'` and `orderCount>0` |
| `BLOQUÉ` | `CustomerBlock` exists |
| `À ENVOYER` | `deliveryStatus='pending'` or (`status ∈ confirmed|preparing` and no shipment) |
| `CRÉÉE` | `Shipment.status='sent'` (the Figma word "created" reads `sent`) |
| `RAMASSÉE` | `Shipment.status='picked_up'` |
| `SANS MOUVEMENT` | `Shipment.status='stale'` (no event for 30 d), or overview tab "Sans mouvement" = no event for > 5 d while `status ∈ sent|picked_up|in_transit` |
| `MASQUÉ` (product) | `isActive=false` and not archived |
| `BROUILLON` (agent) | `Agent.status='draft'` |
| `EN ATTENTE META` (channel) | `Channel.status='pending_review'` |
| `DÉSACTIVÉ` / `EN PAUSE (PLAN)` (channel) | `status='disabled'` / `status='paused' && pausedReason='plan'` |
| `AJUST. +` / `AJUST. −` | `MovementType.adjustment_in` / `adjustment_out` |
| Notification type filters | `NotificationDto.group` (api-contract §3.12); type → group mapping: see 03 §15 |
| `ESSAI` | `Subscription.status='trial'` |
| `RELANCE` | `Subscription.status='dunning'` + `dunningStage` |
| `SUSPENDU` | `Workspace.status='suspended'` |

---

## 5. Error codes

All error codes live in `11-error-catalogue.md` (§1–§12) and are imported by `pnpm i18n:import-errors`.
Aliases exist only in 11 §13 and `packages/shared/src/errors/aliases.ts`.
No code is defined here.

---

## 6. Formatting & RTL rules

| Topic | Rule |
|---|---|
| Direction | `ar` ⇒ `dir="rtl"`; layout mirrored by logical CSS; directional icons mirrored; charts stay LTR. |
| Numbers | Always Latin digits (`0-9`), never Arabic-Indic, in all locales; wrapped in `<Ltr>`; thousands separator narrow no-break space (`12 500`), no decimals for DA. |
| Currency | `{amount} DA` in fr/en and in the AR merchant UI; `دج` only in customer-facing AR messages. |
| Phones | Displayed `0555 12 34 56` (groups 4-2-2-2), `<Ltr>`, stored `0555123456`. |
| Dates | Merchant UI: `dd MMM yyyy` (`06 oct. 2026`), time `HH:mm`, relative `il y a 2 min` / `hier` / date; all in `Africa/Algiers`. Exports: `yyyy-MM-dd HH:mm`. |
| Order numbers / SKUs / tracking | `<Ltr>`, monospace `Label/Section` style for tracking numbers. |
| Percentages | `68 %` (space before % in fr; `68%` in en; `٪` not used). |
| Capitalisation | Pills uppercase via CSS (`text-transform`), keys stored in sentence case except where Figma shows uppercase labels (section labels), which are stored uppercase. |
| Plurals | ICU in all locales; `ar` must provide `zero one two few many other`. |
| Fonts | Geist (fr/en body), Changa (`ar` body/title), Syne (display, all), JetBrains Mono (labels, all). |
| Line length | AR strings run ~20 % longer in width; table columns sized for FR + 20 %. |
| Interpolation | Never concatenate strings in code; use ICU params. |
| Emojis | Allowed only in customer messages and Figma-sourced labels (`✦ IA`); never added by the coder. |

---

## 7. Do / Don't

**Do**
- Copy FR strings verbatim from the Figma frame; keep punctuation (`·`, `›`, `…`, `«  »`).
- Add a key once; reuse across screens.
- Run `pnpm i18n:check` before every commit; AR/EN must contain every FR key.
- Use `enum.*` keys for every pill and select option.

**Don't**
- Don't write user-visible text in components, API responses or e-mails without a key.
- Don't translate product data, SKUs, numbers, order numbers.
- Don't invent new enum labels; map Figma pills per §4.
- Don't use Arabic-Indic digits anywhere.
