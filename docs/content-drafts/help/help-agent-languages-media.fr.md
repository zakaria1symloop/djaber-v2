---
key: help-agent-languages-media
type: help
category: ai_agent
pages: [agents/new, agents/configuration, agents/playground]
sortOrder: 23
locale: fr
title: Langues, photos et notes vocales
---
L’agent détecte la langue de chaque client et lui répond dans cette langue, parmi celles que vous cochez. Il peut aussi comprendre les photos et les notes vocales des clients ; ces réponses coûtent plus de crédits qu’une réponse texte.

## Les langues
Étape « Identité », bloc « Langues & ton ». Cochez les langues que l’agent peut utiliser : Darija (arabe algérien), Arabizi (3arbi bel latin), Français, Arabe standard, Kabyle (tamazight), Anglais. Choisissez la « LANGUE PAR DÉFAUT (SI INDÉTERMINÉE) » : elle doit faire partie des langues cochées.

Réglez aussi le « TON » (Chaleureux & concis, Professionnel, Décontracté, Premium), le « TUTOIEMENT » (Tutoyer, Vouvoyer, Suivre le client) et les « EMOJIS » (Sans emoji, Avec modération, Beaucoup). L’aperçu montre une réponse d’exemple avec ces réglages ; le produit et le prix de l’aperçu sont fictifs.

Les messages système (transfert, hors horaires, accueil) sont envoyés dans la langue du dernier message du client : français, arabe ou anglais.

## Les photos
Capacité « Comprendre les photos envoyées par le client » (étape « Comportement »). L’agent retrouve le produit de votre catalogue sur la photo ; s’il n’y arrive pas, il demande « envoyez-moi le nom du produit ». Les photos de vos fiches produit, avec leur légende générée par l’IA, l’aident à reconnaître vos articles.

## Les notes vocales
Capacité « Transcrire et répondre aux notes vocales ». L’agent transcrit la note puis répond. Au-delà de 2 minutes, il demande au client d’écrire.

## Le coût en crédits
Le coût de chaque capacité est affiché à côté d’elle dans l’assistant, et le récapitulatif de droite estime votre consommation. Aux tarifs actuels : 1 crédit par réponse texte, 5 crédits par réponse à une photo reconnue, 3 crédits par note vocale transcrite. Les tests du bac à essai ne consomment aucun crédit.

## Tester
Dans le bac à essai, « Joindre une photo » et « Joindre une note vocale » simulent un client. Les scénarios automatiques « Photo d'un produit » et « Note vocale » vérifient ces capacités ; le scénario photo n’est pas lancé si la compréhension des photos est désactivée ou si aucun produit du périmètre n’a de photo.

## Ce que l’agent ne traite pas
Pour un média non pris en charge ou une note vocale incompréhensible, le client reçoit un texte fixe de Djaber (Paramètres › Messages système › « Textes fixes Djaber »), au plus une fois par conversation et par 24 h.
