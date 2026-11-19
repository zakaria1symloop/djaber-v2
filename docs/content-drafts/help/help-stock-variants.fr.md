---
key: help-stock-variants
type: help
category: stock
pages: [products, products/new, products/edit]
sortOrder: 41
locale: fr
title: Produits à variantes (taille, couleur…)
---
Un produit à variantes a un stock, un prix, un coût et un seuil d'alerte par variante. Son stock total est la somme de ses variantes.

## Créer les variantes
Dans le formulaire du produit, section « Variantes » :
- « + Ajouter une variante » crée une variante à la main ;
- « Générer des variantes » crée toutes les combinaisons d'un coup : écrivez un attribut par ligne, au format « Nom : valeur 1, valeur 2 », par exemple « Taille : S, M, L, XL » puis « Couleur : Noir, Rouge » (« + Attribut » pour en ajouter un).

Le générateur affiche combien de variantes seront créées, avec un SKU automatique, un PRIX PAR DÉFAUT et un STOCK PAR DÉFAUT. Les variantes qui existent déjà sont conservées. Un produit compte 100 variantes au maximum, et deux variantes d'un même produit ne peuvent pas porter le même nom. Un SKU est unique dans tout votre catalogue, produits et variantes compris.

## Modifier une variante
Sur la fiche produit, cliquez sur une ligne du tableau « Variantes » pour modifier son prix, son coût et son seuil. Le stock d'une variante ne se modifie jamais directement : utilisez « Ajuster » sur sa ligne, pour que chaque changement soit tracé dans Mouvements.

## Stock et commandes
- Les commandes, les ventes, les achats et les inventaires se font au niveau de la variante.
- Un seuil d'alerte peut être fixé par variante.
- Un produit à variantes suit toujours son stock : pour en faire un service, supprimez d'abord ses variantes.
- Une variante supprimée est retirée du produit et son stock n'est plus compté ; les commandes passées gardent leur ligne.

Dans les conversations, la variante nommée par le client est celle que l'IA reprend dans le récapitulatif de la commande.
