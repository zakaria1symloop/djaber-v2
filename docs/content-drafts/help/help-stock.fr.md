---
key: help-stock
type: help
category: stock
pages: [products, stock, movements, inventory]
sortOrder: 40
locale: fr
title: Gérer votre stock
---
Le stock ne bouge que par des mouvements tracés : commandes confirmées, ventes, achats reçus, retours, ajustements et inventaires. Une nouvelle commande réserve les unités sans les sortir du stock.

## Réservé, disponible, sorti
- Une nouvelle commande réserve le stock : la fiche produit l'affiche dans « RÉSERVÉ (commandes pas encore confirmées) » et « DISPONIBLE POUR L'IA » baisse d'autant.
- Quand vous confirmez la commande, les unités sortent du stock (mouvement « Commande confirmée »).
- Une commande annulée libère sa réservation, ou remet les unités en stock si elles étaient déjà sorties (mouvement « Commande annulée »).
- Un retour reçu remet les unités en stock (mouvement « Retour de commande »).

Une commande est refusée quand le stock disponible ne suffit pas, sauf pour un produit où « Accepter les commandes en rupture de stock » est coché : il reste commandable à stock 0, le stock peut passer sous zéro et l'IA prévient le client que la livraison peut prendre un peu plus de temps.

## Ajuster le stock
Le stock ne change que par ajustement : « Ajuster le stock » (fiche produit ou Mouvements), avec une quantité positive ou négative et un motif. Cette action est réservée au propriétaire et aux admins. Pour un service ou un produit digital, décochez « Suivre le stock » : aucune quantité n'est alors suivie.

## Mouvements
La page Mouvements liste chaque entrée et sortie avec son motif. Un mouvement ne se modifie ni ne se supprime : « Contre-passer » crée le mouvement inverse.

## Seuil d'alerte
Fixez un « SEUIL D'ALERTE » sur le produit (ou par variante) : vous êtes alerté quand le stock atteint ce seuil ou passe en dessous. Le rapport « Stock faible / rupture » liste les produits et variantes concernés.

## Inventaire
- Ouvrez Inventaires puis « Lancer un inventaire » : tout le stock, une catégorie ou les produits en alerte. Vous pouvez « Bloquer les ventes comptoir pendant le comptage » ; les commandes et l'IA ne sont pas concernées.
- Comptez, sur la feuille de comptage imprimable ou en saisissant les quantités. Une note est obligatoire pour un écart de plus de 10 %.
- « Valider l'inventaire » (propriétaire ou admin) crée un mouvement « Inventaire » par écart. Un seul inventaire peut être en cours à la fois.

## Archiver un produit
À l'archivage, cochez « Sortir le stock restant » pour retirer le stock qui reste (mouvement « Archivage »).

Mouvements, Inventaires, Achats, Ventes et Caisse n'apparaissent qu'en mode « Avancé » (Paramètres › Mode stock). Passer en mode « Simple » ne supprime rien.
