---
key: help-purchases
type: help
category: stock
pages: [purchases, purchases/new, suppliers]
sortOrder: 42
locale: fr
title: Achats fournisseurs et réception du stock
---
Un achat enregistre ce que vous commandez à un fournisseur ; le stock n'augmente qu'à la réception. Chaque réception recalcule le prix de revient moyen du produit.

## Les étapes d'un achat
- Créez le fournisseur si besoin (Fournisseurs › « + Nouveau fournisseur »).
- Achats › « + Nouvel achat » : choisissez le fournisseur, les produits ou variantes, les quantités et les coûts unitaires. L'achat est en « Brouillon ».
- « Commander » le passe à « Commandé » : le montant devient dû au fournisseur.
- « Réceptionner » : saisissez les quantités réellement reçues, la date et, si vous le voulez, le N° facture fournisseur et un « Paiement à la réception (DA) ». L'achat passe « Reçu en partie » ou « Reçu ».

Chaque réception crée un mouvement d'entrée (« Achat reçu ») par ligne. Une quantité reçue supérieure à la quantité commandée est acceptée et complète le bon de commande. Les services et les produits sans suivi de stock ne peuvent pas être achetés.

## Le prix de revient
À chaque réception, le prix de revient du produit (ou de la variante) devient la moyenne pondérée du stock déjà présent et des unités reçues, arrondie au dinar. Tant qu'aucun coût n'est saisi ni reçu, le prix de revient reste inconnu et la marge n'est pas calculée.

## Payer le fournisseur
« Payer le solde » enregistre un paiement ; chaque paiement sort de la Caisse sur une ligne automatique. Le solde dû reste visible sur l'achat et sur la fiche du fournisseur.

## Annuler ou supprimer
- « Annuler l'achat » est possible tant que l'achat n'est pas entièrement reçu. Si une partie a déjà été reçue, ces unités restent en stock et restent dues ; seul le reste non reçu est annulé.
- Un achat ne se supprime que s'il est en « Brouillon » ou « Commandé » et non payé.
- Pour corriger des unités déjà reçues, utilisez un ajustement de stock.

Un fournisseur désactivé ne reçoit plus de nouvel achat : réactivez-le d'abord. Les achats sont réservés au propriétaire et aux admins, en mode « Avancé ».
