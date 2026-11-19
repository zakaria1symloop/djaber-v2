---
key: help-agent-knowledge
type: help
category: ai_agent
pages: [agents/new, agents/configuration]
sortOrder: 21
locale: fr
title: Ce que l’agent sait : catalogue, règles de la boutique et FAQ
---
L’agent ne vend que les produits de son périmètre, au prix de votre catalogue, et ne promet que vos règles. Pour tout le reste, il dit qu’il se renseigne et transmet la conversation à votre équipe.

## Le catalogue
Source unique : vos produits, avec leur prix, leur stock et leurs variantes en temps réel. L’agent n’invente jamais de prix.

- « Tout le catalogue » : les produits masqués ou en attente de validation Djaber sont exclus automatiquement.
- « Seulement certaines catégories » : l’agent ne propose que les produits de ces catégories.
- « Produits en rupture » : proposer une alternative de la même catégorie plutôt que « indisponible ».
- « Afficher les variantes manquantes » : par exemple « la taille M est épuisée, il reste S et L ».

La phrase utilisée pour un produit en rupture est le message « Rupture de stock » de Paramètres › Messages système.

## Les règles de la boutique
Quatre champs, ajoutés à chaque réponse de l’agent : « LIVRAISON », « PAIEMENT », « RETOURS / ÉCHANGES » et « HORAIRES / DÉLAI DE RÉPONSE HUMAINE ». Écrivez-les courts et factuels, par exemple « Paiement à la livraison uniquement » ou « Échange sous 7 jours si non porté ». L’agent ne promet rien qui n’y figure pas.

## La FAQ
Questions fréquentes, histoire de la marque, conseils d’utilisation : 50 entrées et 20 000 caractères au maximum. Chaque entrée indique sa source : « SAISI », « EXTRAIT DE LA PAGE FB », « FICHIER » ou « SUGGÉRÉ PAR L'IA ».

- « + Ajouter une question » : saisie manuelle.
- « Extraire depuis ma page Facebook » : l’IA lit les conversations récentes de la page et propose des questions / réponses (gratuit, 3 par jour ; une page connectée est nécessaire).
- « Importer un fichier (DOCX, TXT · 5 Mo) » : les questions / réponses sont lues dans le fichier.
- « Voir les questions sans réponse › » ouvre l’onglet « Insights » de l’agent : les questions de vos clients auxquelles il n’a pas su répondre, à ajouter à la FAQ.

La FAQ s’ajoute une fois le brouillon créé (étape 1 enregistrée).

## Améliorer l’agent au fil du temps

- Dans le bac à essai, « Ajouter une instruction depuis ce tour » ajoute une ligne aux instructions de l’agent.
- L’onglet « Insights » de la page de l’agent propose des corrections à partir de vraies conversations.

Chaque modification crée une nouvelle version, restaurable depuis la page de l’agent.
