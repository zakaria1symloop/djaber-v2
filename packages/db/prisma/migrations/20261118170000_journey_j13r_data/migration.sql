-- Journey J13r (18/11), data only, idempotent (a second run changes nothing).
-- J13-3: the Starter / Gratuit / Pro plans kept an empty Arabic / English description. Only an empty locale is filled, and only
-- while the French text is still the seeded one (a description written in Admin › Plans is kept).
UPDATE "Plan" SET "description" = jsonb_build_object(
    'fr', "description"->>'fr',
    'ar', CASE WHEN coalesce("description"->>'ar', '') = '' THEN 'للبدء' ELSE "description"->>'ar' END,
    'en', CASE WHEN coalesce("description"->>'en', '') = '' THEN 'To get started' ELSE "description"->>'en' END)
  WHERE "slug" = 'free' AND "description"->>'fr' = 'Pour démarrer'
    AND (coalesce("description"->>'ar', '') = '' OR coalesce("description"->>'en', '') = '');
UPDATE "Plan" SET "description" = jsonb_build_object(
    'fr', "description"->>'fr',
    'ar', CASE WHEN coalesce("description"->>'ar', '') = '' THEN 'للمتاجر النامية' ELSE "description"->>'ar' END,
    'en', CASE WHEN coalesce("description"->>'en', '') = '' THEN 'For growing shops' ELSE "description"->>'en' END)
  WHERE "slug" = 'starter' AND "description"->>'fr' = 'Pour les boutiques qui grandissent'
    AND (coalesce("description"->>'ar', '') = '' OR coalesce("description"->>'en', '') = '');
UPDATE "Plan" SET "description" = jsonb_build_object(
    'fr', "description"->>'fr',
    'ar', CASE WHEN coalesce("description"->>'ar', '') = '' THEN 'لفرق المبيعات' ELSE "description"->>'ar' END,
    'en', CASE WHEN coalesce("description"->>'en', '') = '' THEN 'For sales teams' ELSE "description"->>'en' END)
  WHERE "slug" = 'pro' AND "description"->>'fr' = 'Pour les équipes de vente'
    AND (coalesce("description"->>'ar', '') = '' OR coalesce("description"->>'en', '') = '');

-- J13-7: a speech-to-text model (Whisper) is a voice model only — it was marked « texte » too, so the text route offered it
-- and its provider card read « Whisper large v3 turbo (Groq) (texte) ».
-- A text / vision route that named a Whisper model as fallback loses that fallback (it could never answer a text message).
UPDATE "AiRoute" SET "fallbackModelId" = NULL, "failoverActive" = false, "failoverSince" = NULL
  WHERE "capability" <> 'transcription' AND "fallbackModelId" IN (SELECT "id" FROM "AiModel" WHERE "modelId" ILIKE '%whisper%');
UPDATE "AiModel" SET "capabilities" = ARRAY['transcription']::"AiCapability"[]
  WHERE "modelId" ILIKE '%whisper%' AND "capabilities" <> ARRAY['transcription']::"AiCapability"[];
