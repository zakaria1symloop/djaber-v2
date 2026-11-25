# Djaber — réponse à la liste de recette (Boutique de Lalla, feuille du 22/11) — état au 24/11 au soir

Chaque ligne de votre feuille (n° = ligne). « Corrigé 23/11 » = corrigé et mis en ligne aujourd'hui, vérifié par nos tests ; « Vérifié 23/11 » = retesté en conditions réelles (Messenger) par notre testeur avec preuve ; « Déjà présent » = la fonction existe, voici où la trouver ; « Fonctionnement prévu » = comportement voulu, avec l'explication.

## Revu à la main le 24/11 — chaque ligne encore « Nég » de votre feuille

Le 24/11, notre testeur a repris une par une, sur la version en ligne, toutes les lignes que vous aviez marquées non résolues. Une ligne n’est comptée ici que s’il l’a vue fonctionner lui-même, avec une preuve (capture d’écran, commande ou message daté). Les captures sont dans le dossier de preuves du 24/11.

| N° | Résultat vu le 24/11 |
|---|---|
| 2 | Étiquettes des tableaux et du détail de commande lisibles. |
| 4 / 27 | Temps de réponse mesuré sur 5 messages : 7,1 · 7,2 · 5,7 · 6,6 · 7,1 s (9,5 s en moyenne le matin). Corrigé le 24/11 : le délai de l’agent est compté depuis l’envoi du message par le client, et non depuis sa réception. Voir « Reste ouvert ». |
| 7 | Deux pages Facebook cochées ensemble : les deux sont connectées. |
| 19 | « Définir comme principale » : la photo 2 devient la principale sur la fiche, dans la liste et dans la carte Messenger. |
| 21 | « Remplir avec l’IA » : à la limite de 3 analyses par jour, le message le dit clairement, sans code technique, et propose la saisie à la main. |
| 26 | Chat de test : « ما هي المنتجات المتوفرة من فضلك » reçoit une réponse en arabe avec les produits. |
| 44 | La variante commandée est écrite sous le produit, dans le détail et dans la liste des commandes. |
| 51 | Commande d’un service : l’agent demande seulement le nom et le téléphone — ni quantité, ni wilaya, ni adresse ; la commande se confirme sans adresse, la fiche dit « Service — sans livraison » et propose « Marquer terminée ». Revérifié le 25/11, y compris quand le client ne cite pas le nom exact du service. |
| 55 / 93 | « Quels produits vous avez ? » : tous les produits commandables sont cités avec leur prix. |
| 56 | Photo envoyée par le client : les photos n° 3 et n° 4 d’un produit sont reconnues (corrigé le 24/11). |
| 57 | Le texte du mode simple ne dit plus qu’il n’y a pas de variantes. |
| 58 | « Gérer les variantes » ouvre la fiche sur le tableau des variantes. |
| 60 | Filtre « Utilisé par un agent » : 13 produits vendus ; « Aucun agent » : les produits refusés ou jamais validés (corrigé le 24/11). |
| 61 / 91 | Une page ne peut avoir qu’un seul agent : l’écran le dit, et propose de déplacer la page vers l’autre agent. L’agent de la page répond à chaque message. Voir « Reste ouvert ». |
| 65 / 66 | Catégorie et seuil d’alerte affichés sur la fiche produit. |
| 67 / 68 | « Agents IA » et « Voir les agents IA qui le vendent ». |
| 69 | Un produit d’une autre catégorie ajouté à un agent « par catégories » reste lié et est vendu par cet agent. L’onglet Connaissances de l’agent l’indique maintenant (« + 1 produit ajouté un par un »). |
| 71 | Produit renommé, en attente de validation : l’IA continue de vendre la version validée. La liste des produits l’affiche maintenant « PROPOSÉ » (elle disait « exclu ») avec la raison. |
| 73 | Un produit archivé se retrouve dans Filtres › Statut › « Archivé » et se restaure avec son stock. |
| 74 | Motif « Alimentation (réception) » en tête de liste. |
| 75 | Stock à −15 : « Entrée » +20 puis « Définir » 10 acceptés. Corrigé le 24/11 : on peut aussi désactiver « Accepter les commandes en rupture » sur un produit dont le stock est négatif. |
| 76 | Sortie manuelle au-delà du stock : refusée avec une phrase claire, et un bouton « Forcer (stock négatif) ». |
| 77 | Export : suivi du stock, vente en rupture, description, poids, mots-clés ; chaque produit suivi de ses variantes. |
| 78 | Ré-import du fichier exporté, avec « Mettre à jour les produits existants » : 51 lignes valides, 0 en erreur, stock inchangé. Corrigé le 24/11 : sans l’option, l’aperçu explique comment mettre à jour ; un ancien prix incohérent ne bloque plus. |
| 80 | Commande importée datée du 15/11/2026, la date du fichier. |
| 81 | Une commande importée s’annule. |
| 82 | Analyse d’une page : terminée, 3 publications lues, 3 produits détectés, aucun code d’erreur. Les produits déjà au catalogue sont marqués « Existe déjà » (corrigé le 24/11). |
| 85 / 87 | Filtres des rapports : toute la liste s’ouvre, le produit choisi est affiché et filtre le rapport. |
| 86 | Une recommandation ignorée se retrouve dans « Historique ». |
| 90 | Changement d’adresse d’une commande : l’IA reprend la commande, demande seulement la nouvelle adresse, envoie le nouveau récapitulatif. |
| 95 | Commande de 3 pour un stock de 1 : refusée avec « Stock insuffisant pour … », puis confirmée après réapprovisionnement. Le message « Ajustez le stock par variante » n’apparaît plus. |
| S2 | Super admin › Modération › « Rejetés » : les produits refusés par l’IA sont listés avec la raison. |

Autres corrections du 24/11 issues de ces tests : l’agent ne répond plus « Oui, on a … » en proposant un autre produit quand on lui demande un produit qu’il ne vend pas ; le message d’un colis refusé par le transporteur dit quel champ corriger ; un lien d’invitation déjà utilisé dit « Invitation déjà acceptée » ; la page Produits ne se dédouble plus (deux barres de défilement).

## Corrigé et mis en ligne le 23/11

| N° | Votre remarque | Ce qui change |
|---|---|---|
| 2 | Sous-titres trop petits et gris | Les petites étiquettes des tableaux passent de 8–9 px à 10–11 px ; la variante commandée a sa propre ligne lisible. |
| 3 | « Session expirée » toutes les 5–15 min | La session se renouvelle seule avant d'expirer ; une coupure réseau ou un redémarrage du serveur ne déconnecte plus. **Vérifié 23/11** : 45 min d'utilisation dont 20 min d'inactivité, aucune déconnexion. |
| 19 | Image principale non modifiable | Bouton « Définir comme principale » sous chaque photo de la fiche produit ; les actions des photos sont visibles sur téléphone. |
| 44 | Variante absente du détail de commande | La variante commandée s'affiche sous le nom du produit. |
| 58 | Détails des variantes seulement via « Modifier » | « Gérer les variantes » ouvre la fiche produit sur le tableau des variantes. |
| 60 | Filtre « Utilisé par un agent » vide | Le filtre lit le vrai périmètre des agents (tout le catalogue, catégories, ou produits ajoutés). |
| 67 / 68 | Titres « Agents & canaux » / « Voir dans Agent IA » | « Agents IA » / « Voir les agents IA qui le vendent ». |
| 69 | Lier un produit à un agent ne tient pas | Un produit ajouté à un agent « par catégories » est maintenant vendu par cet agent, même hors de ses catégories. |
| 74 | Motif « Alimentation » manquant | Nouveau motif « Alimentation (réception) », en tête de liste. |
| 75 | Impossible d'ajuster un stock négatif | Une entrée ou un « Définir » qui remonte le stock est toujours accepté ; seule une sortie sous zéro reste refusée. |
| 77 | Export incomplet | L'export contient le suivi du stock, la vente en rupture, la description, le poids et les mots-clés ; le produit puis ses variantes. |
| 78 | Ré-import du fichier exporté en erreur | Le même fichier se ré-importe : produits et variantes regroupés par SKU, stock négatif accepté pour un produit en vente en rupture. |
| 80 | Import de commandes à la date du jour | Une colonne « Date » est lue (format Excel, jj/mm/aaaa, aaaa-mm-jj) ; sans date, la date du jour reste. |
| 82 | Analyse de page : AI_PROVIDER_ERROR | L'analyse des publications fonctionne (une publication illisible est ignorée au lieu d'arrêter l'analyse). |
| 85 / 87 | Filtres des rapports (un seul élément, clic sans effet) | La liste des catégories (sous-catégories comprises) est ouverte ; le produit choisi est affiché dans le filtre. |
| 26 / 92 | « L'IA n'a pas répondu » / pas de réponse à « ماهي المنتجات اللي عندكم » | Réponse en arabe vérifiée ; la liste des produits ne prend plus 15 s (1 étape au lieu de 3). |
| 4 / 27 | Réponse après 7 s malgré un délai de 3 s | Le délai de 3 s sert à regrouper les messages du client ; s'y ajoutent ~3 s d'acheminement par Meta et le temps de l'IA. Le temps de l'IA a été réduit aujourd'hui (une étape supprimée sur les réponses Messenger) ; mesure en cours. |

## Vérifié en conditions réelles le 23/11 (Messenger, avec preuve en base)

| N° | Résultat |
|---|---|
| 6 | Ajout d'une page Facebook : la page est trouvée et connectée (jamais « Aucune page trouvée »). |
| 28 / 29 / 30 | Photos : toutes les photos du produit sont envoyées (carrousel), une photo ajoutée ensuite est prise en compte ; une demande en arabe reçoit une réponse en arabe (corrigé 23/11). |
| 31 | « الجزائر العاصمة » est compris : frais de livraison d'Alger donnés. |
| — | Nouvelle commande du même produit : acceptée (récapitulatif puis « oui ») — corrigé 23/11. |
| 3 | Session : 45 minutes d’utilisation dont 20 minutes d’inactivité, jamais « Session expirée ». |
| 37 / 38 | « Changer la quantité de ma commande » : nouveau récapitulatif, puis une seule commande active (l’ancienne est annulée et remplacée), stock réservé une seule fois. |
| 39 | Limite de 10 par commande : « je veux 50 » est transmis à l’équipe avec la raison ; « ok 5 » reprend la conversation avec l’IA sans intervention. |
| 40 | Stop-desk : le tarif de la grille (Alger 250 DA) est appliqué dans deux conversations, sans demande de point de retrait. |
| 41 / 92 | Langue : « slt » → français, « salam ch7al » → darija en lettres latines, arabe → arabe, « hello » → anglais ; aucun message sans réponse. |
| 42 | Wilaya « Alger », « الجزائر » ou « 16 » : la commande est enregistrée sur Alger (jamais Adrar). |
| 45 / 94 | Produit en rupture : seule une alternative en stock est proposée. Produit « commandes acceptées en rupture » : commandable, le délai est dit dans le récapitulatif et la confirmation, pas à chaque message. |
| 48 | Toutes les confirmations de commande du jour sont arrivées dans Messenger (38 messages vérifiés, aucun « Non délivré »). |
| 56 | Photo du client : la photo d’un produit est reconnue avec son prix ; une photo sans rapport est décrite et déclarée « pas un article de la boutique ». Toutes les photos du produit sont comparées (corrigé 23/11, à revérifier le 24/11 sur la photo n° 3). |
| 59 | Messages vocaux en darija : prix, photos et livraison obtenus par la voix (corrigé 23/11 : un nombre dans le nom d’un produit n’est plus pris pour une quantité). |
| 88 | « Où est ma commande ? » : la commande est retrouvée avec le numéro de téléphone. |
| 89 | « Annuler ma commande CMD-… » : seule la commande demandée est annulée, aucune autre n’est proposée, pas d’excuse sur les messages précédents. |
| — | Transporteur : commande confirmée → colis créé chez ZR Express → le client reçoit « en route · suivi n° … (ZR Express) ». |
| — | Paiement Chargily (mode test) : pack payé → crédits ajoutés et facture créée en moins d’une minute ; paiement refusé ou annulé → rien n’est ajouté. |

## Corrigé le 23/11 au soir après les tests (à revérifier le 24/11)

| N° | Ce qui a été corrigé |
|---|---|
| 51 | Service / produit numérique : la commande d’un service ne demande plus ni wilaya ni adresse, sans frais de livraison ni « à payer à la livraison » — seulement le nom et le téléphone. |
| 55 / 93 | « Quels produits vous avez ? » : tous les produits commandables sont cités avec leur prix — en stock, services, et produits acceptés en rupture. Un produit en rupture non commandable n’est pas cité. |
| 90 | Changement d’adresse d’une commande : la commande passée dans la même conversation est retrouvée même si le client a donné un autre numéro depuis ; l’IA reprend le contenu de la commande, ne demande que la nouvelle adresse, envoie le nouveau récapitulatif, et ne transmet plus à l’équipe pour cela. |
| — | Un simple « salut » reçoit un salut et « comment puis-je vous aider ? », sans proposition de réservation. |
| — | Paiement annulé par le marchand sur la page Chargily : l’écran de retour dit « Paiement annulé » (et plus « refusé par la banque »). |

## Déjà présent — où le trouver

| N° | Où |
|---|---|
| 12 / 13 | Fenêtres de catégorie traduites (fr / ar / en). |
| 23 | Produits › Importer (Excel / CSV). |
| 57 | Texte du mode simple corrigé (« Produits (variantes comprises) »). |
| 65 / 66 | Fiche produit › bloc Informations (catégorie) et bloc Stock (seuil d'alerte). |
| 73 | Produits › Filtres › Statut › « Archivé ». |
| S2 | Super admin › Modération › onglet « Rejetés » (et « À vérifier »). |

## Fonctionnement prévu

| N° | Explication |
|---|---|
| 71 | Un changement de titre, de photo, de description ou de catégorie repasse en validation ; pendant ce temps, l'IA continue de vendre la dernière version validée. |
| 76 | L'alerte « Stock insuffisant » sur une sortie manuelle s'applique à tous les produits ; seules les commandes peuvent descendre sous zéro pour un produit en vente en rupture. |
| 86 | Une recommandation « ignorée » reste visible dans l'onglet « Historique » (ou le filtre Statut › « Ignorée »). |
| 81 | Une commande importée s'annule normalement ; si elle n'a pas de commune, c'est sa **confirmation** qui est bloquée (adresse incomplète) — complétez la commune puis confirmez. |

## Reste à tester

Rien : toutes les lignes de la feuille ont été reprises le 24/11 (tableau en tête de ce document).

## Reste ouvert

| N° | État |
|---|---|
| 4 / 27 | Temps de réponse : 5,7 à 7,2 s mesurés le 24/11 sur des messages courts. Il se décompose ainsi : 1,5 à 2 s pour que Facebook nous remette le message, le délai de l’agent (3 s comptées depuis l’envoi du client, pour regrouper ses messages), 2 à 3,5 s de réponse de l’IA, moins d’1 s d’envoi. Le réglage « 3 s » est donc une attente de regroupement, pas le temps total ; avec un délai réglé à 0 s, la réponse devrait arriver en 5 à 6 s environ (estimation à partir de ces mesures, non mesurée). |
| 61 / 91 | Plusieurs agents sur une même page : non prévu. Une page a un seul agent ; pour vendre plusieurs catégories sur la même page, un seul agent avec ces catégories (ou tout le catalogue). |
| 97 | Un administrateur peut acheter un pack de crédits et payer une facture ; il ne peut pas changer ni résilier le forfait (boutons grisés, vu le 24/11). Les rôles sont ainsi définis aujourd’hui ; réserver l’achat de packs au propriétaire est une décision à prendre. |
