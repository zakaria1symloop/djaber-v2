---
key: help-agent-handoff
type: help
category: ai_agent
pages: [agents/configuration, queue, inbox, settings/system-messages]
sortOrder: 22
locale: fr
title: Transfert à un humain : quand l’agent passe la main
---
Quand une situation dépasse l’agent, il transmet la conversation à votre équipe : elle passe dans la File d’attente avec le motif, et l’IA se met en pause sur cette conversation.

## Les règles de transfert
Étape « Comportement » de l’assistant (ou onglet « Configuration »), bloc « Passer la main à un humain ». Cochez les situations où l’agent doit transmettre :

- Le client demande un humain, un remboursement ou dépose une réclamation
- Le client est en colère (ton détecté)
- 3 messages incompréhensibles d'affilée
- Question hors catalogue / hors règles
- Commande > montant max ou > quantité max
- Client marqué « bloqué » ou « risque » dans Clients
- Mot-clé personnalisé : un des mots-clés que vous ajoutez (30 au maximum, Entrée ou virgule pour ajouter)

Les limites « QUANTITÉ MAX PAR COMMANDE » et « MONTANT MAX (DA) » se règlent dans « Prise de commande » ; vides, il n’y a pas de limite.

## Ce que reçoit le client
Le message « Transfert à un humain » de Paramètres › Messages système, une fois par transfert, dans la langue du client (français, arabe ou anglais). Si vous avez réglé des « Horaires d'ouverture », le message « Hors horaires » est envoyé hors de ces horaires, au plus une fois par conversation et par 24 h ; l’IA continue de répondre et de prendre les commandes.

## Ce que voit votre équipe

- La conversation apparaît dans File d’attente et dans l’onglet « À traiter » de la Boîte de réception, avec le bandeau « L’agent a transmis la conversation : » suivi du motif.
- « Me l'assigner » pour la prendre en charge, puis répondez depuis la conversation.

## Quand l’IA reprend

- À tout moment : « Reprendre l'IA » dans la conversation. « Mettre l'IA en pause » fait l’inverse.
- D’elle-même, si personne de l’équipe n’a écrit et que personne n’a mis l’IA en pause : au message suivant du client, une fois le transfert vieux de 30 min, ou tout de suite si le client revient seulement pour saluer (« salam », « bonjour »). Si le client avait demandé l’équipe (humain, remboursement, réclamation, colère, mot-clé, limites), seuls les 30 min comptent.
- Jamais d’elle-même : après une pause par un membre, pour un client à risque, quand les crédits ou le quota de conversations sont épuisés.

Sans crédits, « Reprendre l'IA » reste grisé jusqu’au prochain achat de pack ou au renouvellement.

## Tester
Dans « Test & activation », les scénarios réclamation, remboursement et grosse quantité vérifient que l’agent transmet bien, avec votre message de transfert.
