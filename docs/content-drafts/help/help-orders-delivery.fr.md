---
key: help-orders-delivery
type: help
category: orders_delivery
pages: [orders, orders/new]
sortOrder: 30
locale: fr
title: Confirmer et expédier une commande
---
Chaque commande passe par la confirmation avec le client, puis la préparation et l'envoi. Djaber met à jour le stock, la caisse et la fiche client à chaque étape.

## Les statuts d'une commande
Une commande va de « Nouvelle » à « Confirmée », « En préparation », « Expédiée » puis « Livrée ». Elle peut aussi finir « Annulée » ou « Retournée ». Le menu « Actions » ne propose que les passages permis depuis le statut actuel.

## Confirmer par téléphone
- Ouvrez la commande et choisissez « Appeler pour confirmer » dans « Actions ».
- Étape VÉRIFIER : contrôlez les articles, le téléphone et l'adresse. Wilaya, commune et adresse (ou stop-desk) sont obligatoires ; sinon cliquez sur « Compléter l'adresse ».
- Étape APPEL : appelez le client puis choisissez le résultat : « Confirmée », « Sans réponse », « Occupé », « Messagerie », « Rappeler plus tard », « Refusée » ou « Faux numéro ».
- Étape RÉSULTAT : une commande confirmée vous propose la suite, « Préparer » ou « Envoyer au transporteur ».

« Refusée » et « Faux numéro » annulent la commande tant qu'aucun colis n'est parti ; « Faux numéro » marque aussi le client « risque ». Après 3 appels sans réponse, Djaber vous propose d'annuler ou de « Programmer un rappel ». Pour noter un appel en dehors de la confirmation, utilisez « Journaliser un appel ».

## Après un appel sans réponse
Tant que le dernier appel est resté sans réponse ou qu'un rappel est prévu, la commande ne peut pas passer en préparation, expédiée ou livrée : « Le client n'a pas encore confirmé : confirmez d'abord la commande. » Confirmez-la par un appel réussi, ou par « Marquer confirmée » si le client a confirmé autrement (par message, par exemple).

## Le stock
Une nouvelle commande réserve le stock (« Réservé » sur la fiche produit) sans mouvement. À la confirmation, les unités sortent du stock (mouvement « Commande confirmée »). Une annulation libère la réservation ou remet les unités en stock.

## Expédier et livrer
- Avec un transporteur : « Envoyer au transporteur ». Si l'envoi automatique est activé, la commande confirmée part seule chez le transporteur par défaut : suivez le colis dans le bloc Livraison de la commande.
- Avec vos propres livreurs : « Marquer expédiée (manuel) » (numéro de suivi facultatif), puis « Marquer livrée (auto-livraison) ».
- À la livraison, le montant encaissé proposé est le reste à payer (acompte déduit). Il entre dans la Caisse sur une ligne automatique verrouillée.
