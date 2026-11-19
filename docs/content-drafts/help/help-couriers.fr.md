---
key: help-couriers
type: help
category: orders_delivery
pages: [delivery/couriers, delivery/fees]
sortOrder: 31
locale: fr
title: Connecter ZR Express, EcoTrack ou Yalidine
---
Connectez votre compte transporteur dans Livraison & suivi › Transporteurs pour créer les colis depuis vos commandes. Vous pouvez aussi livrer avec vos propres livreurs (livraison propre).

## Ajouter un transporteur
- Ouvrez Livraison & suivi › Transporteurs et cliquez sur « + Ajouter un transporteur ».
- Choisissez ZR Express, EcoTrack ou Yalidine et collez les identifiants de votre espace transporteur : ZR Express nouvelle plateforme (zrexpress.app) = clé API + ID tenant ; ancienne plateforme (Procolis) = token + clé ; EcoTrack = URL de l'instance + token ; Yalidine = ID + token.
- Renseignez l'expéditeur : nom, téléphone, adresse de ramassage et wilaya de départ.
- Cliquez sur « Tester » : Djaber appelle le transporteur (10 secondes au plus). « OK » : le compte est reconnu. « Refusé » : vérifiez les identifiants. « Injoignable » : réessayez plus tard, l'enregistrement reste possible sans test.

Les identifiants sont chiffrés et ne sont jamais réaffichés. Avec l'ancienne plateforme Procolis, ni l'étiquette ni l'annulation ne passent par l'API : Djaber imprime son propre bordereau et un colis s'annule dans votre espace ZR Express.

## Transporteur par défaut et envoi automatique
- « Définir par défaut » choisit le transporteur proposé à l'envoi.
- « Envoi automatique au transporteur » : chaque commande confirmée part chez le transporteur par défaut, sans autre clic. Laissez-le désactivé si vous voulez vérifier chaque commande avant l'envoi.
- « Désactiver » arrête les nouveaux envois ; les colis en cours restent suivis.

## Livraison propre
Vos propres livreurs n'ont besoin d'aucun compte : depuis une commande confirmée, choisissez « Marquer expédiée (manuel) ». Le bordereau Djaber est imprimable et le statut se met à jour à la main.

## Grille des frais
Le client paie toujours votre grille (Livraison & suivi › Grille des frais) : par wilaya, un prix DOMICILE, STOP-DESK et RETOUR. « Copier depuis un transporteur » reprend ses tarifs après un aperçu des différences. « Livraison offerte à partir de » s'applique au sous-total après remise, en livraison à domicile seulement. Une wilaya non desservie est annoncée au client par l'IA. Les tarifs du transporteur servent seulement au calcul de votre coût et de votre marge.

Les wilayas 59 à 69 sont envoyées aux transporteurs sous le code de leur wilaya d'origine, avec le vrai nom de la commune.

Les transporteurs et la grille se règlent par le propriétaire et les admins ; tous les membres peuvent envoyer des colis.
