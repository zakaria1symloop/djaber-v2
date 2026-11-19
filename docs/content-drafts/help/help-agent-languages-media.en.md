---
key: help-agent-languages-media
type: help
category: ai_agent
pages: [agents/new, agents/configuration, agents/playground]
sortOrder: 23
locale: en
title: Languages, photos and voice notes
---
The agent detects each customer’s language and answers in it, among the languages you tick. It can also understand customers’ photos and voice notes; those replies cost more credits than a text reply.

## Languages
“Identity” step, block “Languages & tone”. Tick the languages the agent may use: Darija (Algerian Arabic), Arabizi (3arbi bel latin), French, Standard Arabic, Kabyle (Tamazight), English. Pick the “DEFAULT LANGUAGE (WHEN UNDETERMINED)”: it must be one of the ticked languages.

Also set the “TONE” (Warm & concise, Professional, Casual, Premium), the “FORM OF ADDRESS” (Informal (tu), Formal (vous), Follow the customer) and the “EMOJIS” (No emoji, In moderation, A lot). The preview shows a sample reply with these settings; the product and price of the preview are made up.

System messages (handoff, out of hours, welcome) are sent in the language of the customer’s last message: French, Arabic or English.

## Photos
Capability “Understand photos sent by the customer” (“Behaviour” step). The agent finds the product of your catalogue on the photo; when it cannot, it asks “send me the product name”. The photos of your product pages, with the caption the AI generates for them, help it recognise your items.

## Voice notes
Capability “Transcribe and reply to voice notes”. The agent transcribes the note, then replies. Beyond 2 minutes, it asks the customer to write.

## Cost in credits
The cost of each capability is shown next to it in the wizard, and the summary on the right estimates your usage. At current rates: 1 credit per text reply, 5 credits per reply to a recognised photo, 3 credits per transcribed voice note. Playground tests use no credits.

## Test it
In the playground, “Attach a photo” and “Attach a voice note” simulate a customer. The automatic scenarios “Product photo” and “Voice note” check these capabilities; the photo scenario is not run when photo understanding is off or when no product in the agent’s scope has a photo.

## What the agent does not handle
For an unsupported media or an unclear voice note, the customer gets a fixed Djaber text (Settings › System messages › “Djaber fixed texts”), at most once per conversation per 24 h.
