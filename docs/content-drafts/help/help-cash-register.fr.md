---
key: help-cash-register
type: help
category: stock
pages: [cash, sales, sales/new]
sortOrder: 43
locale: fr
title: Caisse, ventes comptoir et clôture de la journée
---
La Caisse est le journal de l'argent qui entre et qui sort. Les lignes automatiques viennent des ventes, des commandes payées ou livrées et des achats payés ; chaque soir, vous pouvez clôturer la journée.

## Lignes automatiques et manuelles
- Les lignes automatiques (ventes comptoir, paiements de commandes, achats payés) sont verrouillées. Pour en corriger une, utilisez « Corriger une ligne automatique » : une ligne de correction est ajoutée, l'originale reste.
- « + Mouvement manuel » ajoute une entrée ou une sortie (avec photo du justificatif si vous le voulez). Son auteur ou un admin peut la modifier ou la supprimer pendant 24 heures, tant que la journée n'est pas clôturée.
- « COD » désigne l'argent encaissé à la porte quand une commande est livrée ; un acompte ou un paiement reçu avant la livraison apparaît en « Espèces ».

## Ventes comptoir
Ventes › « + Nouvelle vente » : produits, remise éventuelle et mode de paiement. Une vente peut rester en brouillon : un brouillon ne fait entrer aucun argent. « Valider la vente » sort le stock et encaisse le montant reçu. Une vente payée en partie doit être liée à un client ; « Encaisser le reste » complète le paiement. Une vente validée ne se modifie plus : pour la corriger, « Annuler la vente » (dans les 7 jours, avec un motif), puis refaites-la. L'annulation remet le stock et rembourse les paiements dans la caisse.

## Clôturer la journée
- « Clôturer la journée » affiche le « Solde théorique (espèces) » : la clôture précédente plus les entrées et sorties en espèces du jour.
- Saisissez le montant « Compté en caisse (DA) ». En cas d'écart, la note est obligatoire et une ligne CORRECTION est créée.
- La journée est alors verrouillée : plus d'ajout ni de modification à cette date. Le montant compté devient le solde d'ouverture du lendemain.

## Rouvrir une journée clôturée
Tant qu'une journée est clôturée, tout mouvement d'argent à cette date est refusé, y compris aujourd'hui : vente encaissée, « Encaisser le reste », remboursement, paiement fournisseur, commande marquée livrée ou payée. Un admin voit le lien « Rouvrir la journée (Caisse) » ; un autre membre lit « Demandez à un administrateur de rouvrir la journée. »

« Rouvrir la journée » est réservé aux admins, demande un motif et est journalisé ; la ligne de correction de la clôture est contre-passée. Clôturez de nouveau une fois la saisie terminée.

La Caisse et les ventes comptoir sont réservées au propriétaire et aux admins, en mode « Avancé ».
