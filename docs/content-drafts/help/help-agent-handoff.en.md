---
key: help-agent-handoff
type: help
category: ai_agent
pages: [agents/configuration, queue, inbox, settings/system-messages]
sortOrder: 22
locale: en
title: Handoff to a human: when the agent hands over
---
When a situation is beyond the agent, it hands the conversation to your team: it moves to the Queue with the reason, and the AI pauses on that conversation.

## The handoff rules
The wizard’s “Behaviour” step (or the “Configuration” tab), block “Hand over to a human”. Tick the situations where the agent must hand over:

- The customer asks for a human, a refund or files a complaint
- The customer is angry (tone detected)
- 3 unclear messages in a row
- Question outside the catalogue / rules
- Order > max amount or > max quantity
- Customer flagged "blocked" or "risk" in Clients
- Custom keyword: one of the keywords you add (30 at most, Enter or comma to add)

The limits “MAX QUANTITY PER ORDER” and “MAX AMOUNT (DA)” are set in “Order taking”; left empty, there is no limit.

## What the customer receives
The “Handoff to a human” message from Settings › System messages, once per handoff, in the customer’s language (French, Arabic or English). If you set “Business hours”, the “Out of hours” message is sent outside those hours, at most once per conversation per 24 h; the AI keeps answering and taking orders.

## What your team sees

- The conversation shows in the Queue and in the Inbox “To handle” tab, with the banner “The agent handed the conversation over:” followed by the reason.
- “Assign to me” to take it, then reply from the conversation.

## When the AI resumes

- At any time: “Resume AI” in the conversation. “Pause AI” does the opposite.
- On its own, if nobody of the team wrote and nobody paused the AI: with the customer’s next message, once the handoff is 30 min old, or at once if the customer only comes back to greet (“salam”, “bonjour”). If the customer had asked for the team (human, refund, complaint, anger, keyword, limits), only the 30 min count.
- Never on its own: after a pause by a member, for a risky client, when the credits or the conversation quota are used up.

Without credits, “Resume AI” stays greyed out until the next pack purchase or the renewal.

## Test it
In “Test & activation”, the complaint, refund and large-quantity scenarios check that the agent does hand over, with your handoff message.
