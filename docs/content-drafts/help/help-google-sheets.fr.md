---
key: help-google-sheets
type: help
category: orders_delivery
pages: [settings/integrations]
sortOrder: 33
locale: fr
title: Envoyer vos commandes dans Google Sheets
---
Djaber peut ajouter chaque commande dans une feuille Google Sheets et la mettre à jour à chaque changement (statut, suivi, contact). La synchronisation va dans un seul sens : de Djaber vers Sheets.

## Connecter la feuille
- Ouvrez Paramètres › Intégrations › Google Sheets.
- Cliquez sur « Connecter Google » et autorisez l'accès avec votre compte Google.
- Cliquez sur « Choisir la feuille » : choisissez une feuille existante ou créez-en une.

Les commandes arrivent dans l'onglet « Commandes » de la feuille. Une colonne cachée permet à Djaber de reconnaître chaque commande : ne la supprimez pas.

## Choisir les commandes envoyées
« Modifier les filtres » limite la synchronisation à certaines pages et à certaines sources : IA, manuel, mobile, API, import. Par défaut, toutes les sources sont envoyées.

## Ajouter les anciennes commandes
« Exporter l'historique (période) » ajoute ou met à jour les commandes d'une période. La tâche tourne en arrière-plan avec une barre de progression ; les commandes déjà présentes sont mises à jour, jamais dupliquées.

## En cas d'erreur
- « Google a retiré l'accès de Djaber » : la synchronisation est en pause. Cliquez sur « Reconnecter Google » pour la reprendre.
- « La feuille a été supprimée ou n'est plus accessible » : choisissez une autre feuille.
- Une erreur de synchronisation vous est aussi signalée par une notification.

Déconnecter Google Sheets arrête la synchronisation, mais la feuille n'est pas supprimée.

## Qui peut le faire
Le propriétaire et les admins de l'espace. Google Sheets dépend de votre plan : si le message « Google Sheets n'est pas inclus dans votre plan » s'affiche, changez de plan dans Paramètres › Plan & facturation.
