---
key: help-agent-knowledge
type: help
category: ai_agent
pages: [agents/new, agents/configuration]
sortOrder: 21
locale: en
title: What the agent knows: catalogue, shop rules and FAQ
---
The agent only sells the products in its scope, at your catalogue price, and only promises your rules. For anything else, it says it will check and hands the conversation to your team.

## The catalogue
Single source: your products, with their price, stock and variants in real time. The agent never invents a price.

- “Whole catalogue”: hidden products and products waiting for Djaber’s review are left out automatically.
- “Only some categories”: the agent only offers the products of these categories.
- “Out-of-stock products”: suggest an alternative from the same category rather than “unavailable”.
- “Show missing variants”: for example “size M is sold out, S and L are left”.

The sentence used for an out-of-stock product is the “Out of stock” message in Settings › System messages.

## The shop rules
Four fields, added to every reply of the agent: “DELIVERY”, “PAYMENT”, “RETURNS / EXCHANGES” and “HOURS / HUMAN RESPONSE TIME”. Keep them short and factual, for example “Cash on delivery only” or “Exchange within 7 days if not worn”. The agent promises nothing that is not written there.

## The FAQ
Frequent questions, brand story, usage tips: 50 entries and 20 000 characters at most. Each entry shows its source: “TYPED”, “EXTRACTED FROM FB PAGE”, “FILE” or “SUGGESTED BY AI”.

- “+ Add a question”: manual entry.
- “Extract from my Facebook page”: the AI reads the page’s recent conversations and proposes questions and answers (free, 3 per day; a connected page is needed).
- “Import a file (DOCX, TXT · 5 MB)”: the questions and answers are read from the file.
- “See unanswered questions ›” opens the agent’s “Insights” tab: your customers’ questions it could not answer, to add to the FAQ.

The FAQ can be filled once the draft exists (step 1 saved).

## Improve the agent over time

- In the playground, “Add an instruction from this turn” adds a line to the agent’s instructions.
- The “Insights” tab of the agent page proposes fixes based on real conversations.

Every change creates a new version, which can be restored from the agent page.
