// M4 — agent wizard (UI side of AT-AGT-02, AT-AGT-04; rules AGV-01…03 of 03-functional-modules §30). Frames:
// "AGT-02 — Agent wizard — step 1 identity … step 5 test & activate", "AGT-02 — step 4 channels (move dialog state)",
// "DLG — Agents & channels". States: 12-screen-states §22 + the GLOBAL catalogue (leave guard, 409 conflict).
// On the REAL M4 API (deterministic fake AI, fake Meta pages, worker running): one shop per run (`setupShop`: verified
// owner on the Pro trial = 5 agents, 2 fake Facebook pages + 1 Instagram, 3 products); every draft, FAQ, page link,
// competing save, plan limit and scenario run is made through the API and the page reads the real answers. The writes
// the page sends are observed (`recordWrites`), never answered in the API's place. `page.route` remains only where the
// API cannot produce the state over HTTP; each use says why (`// mock:`).
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './support/a11y';
import { apiReady, type Account } from './support/m1';
import { patchAnswer } from './support/m3-inbox';
import { agentCard, expectNoHorizontalOverflow, expectRoute, NAV, railRow, sidebar, stepChip, toastOf } from './support/m4-agents';
import { activeAgent, conversationOf, createAgent, getAgent, inject, linkPage, listAgents, nextSender, patchAgent, realGet, realPost, setupShop, type Shop } from './support/m4-real';
import { addFaq, agentWrites, bodyOf, deleteAgent, expectWrites, faqsOf, presetsOf, readinessOf, recordWrites, scenariosOf, signInApi, enter, teamReplies, waitJob, writesOf, failOnce, type RealPreset, type Recorder } from './support/m4-real-wizard';
import { errText } from './support/error-text';

// one shared `next dev` server: first hits compile, so every test gets room for a repeated navigation
test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 1440, height: 1000 } });

let shop: Shop;
let owner: Account;
let presets: RealPreset[];
const RUN = Date.now().toString(36).slice(-4);
test.beforeAll(async ({ request }) => {
  test.skip(!(await apiReady(request)), 'API not reachable on :4010');
  shop = await setupShop(request, 'agtwiz');
  owner = shop.owner;
  presets = await presetsOf(request, owner);
});

const TITLES = {
  identity: "Identité de l'agent",
  knowledge: "Ce que l'agent sait",
  behaviour: "Comment l'agent se comporte",
  channels: 'Sur quelles pages cet agent répond-il ?',
  activate: 'Tester puis activer',
} as const;
type Step = keyof typeof TITLES;
const title = (page: Page, step: Step) => page.getByRole('heading', { name: TITLES[step], level: 1 });
const wizardUrl = (step: Step, id: string, locale = 'fr') => `/${locale}/agents/new/${step}?draft=${id}`;
const stepUrl = (step: Step, id: string) => new RegExp(`/fr/agents/new/${step}\\?draft=${id}$`);
// the API calls of a test go through the request context of its browser context
const api = (page: Page) => page.context().request;

/** A draft made through the API (preset "Vendeur Pro" by default) whose wizard reached `step` (the next one opens). */
async function draftAt(page: Page, name: string, step: number, o: { presetKey?: string; wizard?: Record<string, unknown> } = {}) {
  const draft = await createAgent(api(page), owner, { name, presetKey: o.presetKey, wizard: o.wizard });
  if (step > 1) await patchAgent(api(page), owner, draft.id, { step });
  return getAgent(api(page), owner, draft.id);
}
// a toast follows a write and the refetch of the lists: the shared servers can take seconds
const TOAST = { timeout: 30_000 };
const POLICIES = { delivery: 'Grille Djaber par wilaya · 2–5 jours', payment: 'Paiement à la livraison uniquement (COD).' };

/** Signs in, starts recording the writes of the page and opens a wizard step (`new` = step 1 without draft). */
async function openWizard(page: Page, step: Step | 'new', id?: string): Promise<Recorder> {
  await signInApi(page, owner);
  const rec = recordWrites(page);
  await enter(page, step === 'new' ? '/fr/agents/new' : wizardUrl(step, id!), () => title(page, step === 'new' ? 'identity' : step));
  return rec;
}
const next = (page: Page) => page.getByTestId('wizard-next');
const summary = (page: Page) => page.getByTestId('validation-summary');
const status = (page: Page) => page.getByTestId('wizard-status');
/** "≈ 1,4 crédit / conversation": 1 per text reply, a photo (5) and a voice note (3) in one conversation out of twenty. */
/** Label of a readiness row. */
const label0 = (r: { checks: { key: string; label: string }[] }, key: string) => r.checks.find((c) => c.key === key)!.label;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const estimate = (o: { imageRecognition: boolean; voiceTranscription: boolean }) => `≈ ${String(Math.round((1 + (o.imageRecognition ? 0.25 : 0) + (o.voiceTranscription ? 0.15 : 0)) * 100) / 100).replace('.', ',')} crédit / conversation`;
const CAPABILITY_SHORT: [string, string][] = [
  ['replyText', 'Texte'],
  ['imageRecognition', 'Photo'],
  ['voiceTranscription', 'Vocal'],
  ['takeOrders', 'Commandes'],
  ['quoteDelivery', 'Livraison'],
  ['crossSell', 'Cross-sell'],
];
const capabilitiesLabel = (caps: Record<string, boolean>) => CAPABILITY_SHORT.filter(([k]) => caps[k]).map(([, l]) => l).join(' · ');

test.describe('step 1 — starting point and identity', () => {
  test('AT-AGT-02 the 4 presets + "De zéro"; choosing one updates the summary rail and the credit estimate; axe', async ({ page }) => {
    const rec = await openWizard(page, 'new');
    const start = page.getByTestId('starting-point');
    await expect(start.getByRole('radio')).toHaveCount(5, { timeout: 30_000 });
    // the four seeded presets, in their order, with their real name and tagline
    expect(presets.map((p) => p.key)).toEqual(['vendeur-pro', 'service-client', 'conseiller-produit', 'reponse-express']);
    for (const p of presets) {
      await expect(start.locator(`[data-name="${p.key}"]`)).toContainText(p.name);
      await expect(start.locator(`[data-name="${p.key}"]`)).toContainText(p.tagline!);
      await expect(start.locator(`[data-name="${p.key}"]`)).toHaveAttribute('aria-checked', 'false');
    }
    await expect(start.locator('[data-name="scratch"]')).toContainText('De zéro');
    await expect(start.locator('[data-name="scratch"]')).toContainText('Prompt vide, vous écrivez tout');

    // nothing chosen yet: stepper on step 1, empty rail, draft not created
    await expect(stepChip(page, 'identity')).toHaveAttribute('data-state', 'active');
    await expect(stepChip(page, 'identity')).toHaveAttribute('aria-current', 'step');
    for (const s of ['knowledge', 'behaviour', 'channels', 'activate']) await expect(stepChip(page, s)).toHaveAttribute('data-state', 'upcoming');
    await expect(page.getByTestId('summary-rail')).toContainText('RÉCAPITULATIF (brouillon auto-enregistré)');
    await expect(railRow(page, 'MODÈLE')).toHaveText('—');
    await expect(railRow(page, 'NOM')).toHaveText('—');
    await expect(railRow(page, 'LANGUES')).toHaveText('Darija · Arabizi · FR · AR');
    await expect(status(page)).toHaveText('Brouillon non enregistré · il sera créé à « Continuer » ou « Enregistrer et quitter »');
    await expectNoA11yViolations(page);

    for (const p of presets) {
      await start.locator(`[data-name="${p.key}"]`).click();
      await expect(start.locator(`[data-name="${p.key}"]`)).toHaveAttribute('aria-checked', 'true');
      await expect(start.getByRole('radio', { checked: true })).toHaveCount(1);
      await expect(railRow(page, 'MODÈLE')).toHaveText(p.name);
      // the tagline of the preset is proposed as the description
      await expect(page.getByLabel('DESCRIPTION (INTERNE)')).toHaveValue(p.tagline!);
      // "Réponse express" has no photo: the estimate follows the capabilities of the preset
      await expect(page.getByTestId('credit-estimate')).toContainText(estimate(p));
    }
    expect(estimate(presets.find((p) => p.key === 'reponse-express')!)).toBe('≈ 1,15 crédit / conversation');
    await start.locator('[data-name="scratch"]').click();
    await expect(railRow(page, 'MODÈLE')).toHaveText('De zéro');
    await expect(page.getByLabel('DESCRIPTION (INTERNE)')).toHaveValue('');
    await expect(page.getByTestId('credit-estimate')).toContainText('≈ 1,4 crédit / conversation');

    // identity fields feed the rail and the live preview
    await page.getByLabel('NOM INTERNE').fill('Vendeur du soir');
    await expect(railRow(page, 'NOM')).toHaveText('Vendeur du soir');
    await page.locator('label[data-chip="ar"]').getByRole('checkbox').uncheck();
    await expect(railRow(page, 'LANGUES')).toHaveText('Darija · Arabizi · FR');
    await expect(page.getByTestId('preview-panel').locator('[data-preview="ai"]')).toBeVisible();
    expect(agentWrites(rec)).toEqual([]);
  });

  test('AT-AGT-02 "Continuer" without a name or a starting point shows the validation summary and inline errors; a valid step creates the draft', async ({ page }) => {
    const rec = await openWizard(page, 'new');
    await expect(page.getByTestId('starting-point').getByRole('radio')).toHaveCount(5, { timeout: 30_000 });
    const name = page.getByLabel('NOM INTERNE');
    const NAME = `Agent du soir ${RUN}`;

    // no name
    await next(page).click();
    await expect(summary(page)).toContainText('Validation : 1 erreur');
    await expect(summary(page)).toContainText('Le nom interne est requis.');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[data-section="identity"]')).toContainText('Le nom interne est requis.');

    // 101 characters
    await name.fill('a'.repeat(101));
    await expect(summary(page)).toHaveCount(0); // typing clears the error of the field
    await next(page).click();
    await expect(summary(page)).toContainText('Trop long (100 caractères max)');
    await expect(page.locator('[data-section="identity"]')).toContainText('Trop long (100 caractères max)');
    await expect(name).toHaveAttribute('aria-invalid', 'true');

    // a name, but no starting point
    await name.fill(NAME);
    await next(page).click();
    await expect(summary(page)).toContainText('Choisissez un point de départ : un modèle ou « De zéro ».');
    await expect(page.getByRole('radiogroup', { name: 'POINT DE DÉPART' })).toHaveAttribute('aria-invalid', 'true');
    expect(agentWrites(rec)).toEqual([]);
    await expectRoute(page, '**/fr/agents/new');

    // at least one language (choosing a preset first: it puts its own defaults back)
    await page.getByTestId('starting-point').locator('[data-name="vendeur-pro"]').click();
    await expect(page.getByLabel('NOM INTERNE')).toHaveValue(NAME);
    for (const l of ['darija', 'arabizi', 'fr', 'ar']) await page.locator(`label[data-chip="${l}"]`).getByRole('checkbox').uncheck();
    await next(page).click();
    await expect(summary(page)).toContainText('Cochez au moins 1 langue.');
    expect(agentWrites(rec)).toEqual([]);
    for (const l of ['darija', 'fr']) await page.locator(`label[data-chip="${l}"]`).getByRole('checkbox').check();

    // valid: the draft is created and step 2 opens on it
    await next(page).click();
    const [post] = await expectWrites(rec, 'POST /agents');
    const body = bodyOf(post!) as { presetKey?: string; name?: string; description?: string; wizard?: { languages?: string[]; defaultLanguage?: string; tone?: string } };
    const vendeur = presets.find((p) => p.key === 'vendeur-pro')!;
    expect(body.presetKey).toBe('vendeur-pro');
    expect(body.name).toBe(NAME);
    expect(body.description).toBe(vendeur.tagline);
    expect(body.wizard?.languages).toEqual(['darija', 'fr']);
    expect(body.wizard?.defaultLanguage).toBe('darija');
    expect(body.wizard?.tone).toBe('warm');
    await expectRoute(page, /\/fr\/agents\/new\/knowledge\?draft=[0-9a-f-]{36}$/);
    const id = new URL(page.url()).searchParams.get('draft')!;
    await expect(title(page, 'knowledge')).toBeVisible(NAV);
    await expect(stepChip(page, 'identity')).toHaveAttribute('data-state', 'done');
    await expect(stepChip(page, 'knowledge')).toHaveAttribute('data-state', 'active');
    await expect(railRow(page, 'MODÈLE')).toHaveText(vendeur.name);
    await expect(railRow(page, 'NOM')).toHaveText(NAME);
    await expect(page.getByRole('navigation', { name: "Fil d'Ariane" })).toContainText(NAME);
    // what the API stored
    const saved = await getAgent(api(page), owner, id);
    expect(saved.status).toBe('draft');
    expect(saved.name).toBe(NAME);
    expect((saved as unknown as { preset: { key: string } }).preset.key).toBe('vendeur-pro');
    expect(saved.wizard).toMatchObject({ languages: ['darija', 'fr'], defaultLanguage: 'darija', tone: 'warm' });
  });

  test('AT-AGT-02 the capabilities of the preset reach step 3: "Réponse express" ⇒ photo off', async ({ page }) => {
    const rec = await openWizard(page, 'new');
    await page.getByTestId('starting-point').locator('[data-name="reponse-express"]').click({ timeout: 30_000 });
    await page.getByLabel('NOM INTERNE').fill(`Express du matin ${RUN}`);
    await next(page).click();
    await expect(title(page, 'knowledge')).toBeVisible(NAV);
    expect(bodyOf((await expectWrites(rec, 'POST /agents'))[0]!).presetKey).toBe('reponse-express');
    const id = new URL(page.url()).searchParams.get('draft')!;

    await next(page).click();
    await expect(title(page, 'behaviour')).toBeVisible(NAV);
    expect(bodyOf((await expectWrites(rec, `PATCH /agents/${id}`))[0]!).step).toBe(2);
    // the draft as the API made it from the preset
    const saved = await getAgent(api(page), owner, id);
    const caps = saved.wizard.capabilities as Record<string, boolean>;
    expect(caps.imageRecognition).toBe(false);
    const toggle = (name: string) => page.locator(`[data-toggle="${name}"]`).getByRole('switch');
    await expect(toggle('imageRecognition')).toHaveAttribute('aria-checked', 'false');
    await expect(toggle('voiceTranscription')).toHaveAttribute('aria-checked', String(caps.voiceTranscription));
    await expect(toggle('takeOrders')).toHaveAttribute('aria-checked', String(caps.takeOrders));
    // answering text messages is what an agent does: always on
    await expect(toggle('replyText')).toHaveAttribute('aria-checked', 'true');
    await expect(toggle('replyText')).toBeDisabled();
    await expect(railRow(page, 'CAPACITÉS')).toHaveText(capabilitiesLabel(caps));
    await expect(page.getByTestId('credit-estimate')).toContainText('≈ 1,15 crédit / conversation');
    await toggle('imageRecognition').click();
    await expect(railRow(page, 'CAPACITÉS')).toHaveText(capabilitiesLabel({ ...caps, imageRecognition: true }));
    await expect(page.getByTestId('credit-estimate')).toContainText('≈ 1,4 crédit / conversation');
  });

  test('leave guard: an unsaved name asks "Quitter sans enregistrer ?" — Rester keeps the form, Quitter leaves', async ({ page }) => {
    const rec = await openWizard(page, 'new');
    await expect(page.getByTestId('starting-point').getByRole('radio')).toHaveCount(5, { timeout: 30_000 });
    await page.getByLabel('NOM INTERNE').fill('Agent non enregistré');
    await page.getByLabel('NOM AFFICHÉ AU CLIENT').fill('Amel');

    await sidebar(page).getByRole('link', { name: 'Agents IA', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Quitter sans enregistrer ?' })).toBeVisible();
    await expect(dialog).toContainText('Vous avez des modifications non enregistrées sur « Agent non enregistré ».');
    await dialog.getByRole('button', { name: 'Rester', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectRoute(page, '**/fr/agents/new');
    await expect(page.getByLabel('NOM INTERNE')).toHaveValue('Agent non enregistré');
    await expect(page.getByLabel('NOM AFFICHÉ AU CLIENT')).toHaveValue('Amel');

    await sidebar(page).getByRole('link', { name: 'Agents IA', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Quitter', exact: true }).click();
    await expectRoute(page, '**/fr/agents');
    await expect(page.getByRole('heading', { name: 'Agents IA', level: 1 })).toBeVisible(NAV);
    expect(agentWrites(rec)).toEqual([]); // nothing was created
    expect((await listAgents(api(page), owner)).some((a) => a.name === 'Agent non enregistré')).toBe(false);
  });
});

test.describe('draft — autosave, resume, conflict', () => {
  test('AGV-01 a change is saved by itself, "Enregistrer et quitter" returns to the list, the draft card resumes at the right step, the stepper goes back', async ({ page }) => {
    const DRAFT = `Brouillon repris ${RUN}`;
    await signInApi(page, owner);
    const draft = await draftAt(page, DRAFT, 2, { wizard: { policies: POLICIES } });
    for (const [q, a] of [
      ['Le parfum tient combien de temps ?', '8 à 10 heures sur peau, 24 h sur vêtement.'],
      ['Vous livrez à Tamanrasset ?', 'Oui, 5 à 7 jours via ZR Express, 1 200 DA.'],
      ['C’est original ?', 'Produits importés avec facture ; pas de contrefaçon.'],
    ] as const)
      await addFaq(api(page), owner, draft.id, q, a);
    const rec = await openWizard(page, 'knowledge', draft.id);
    const PATCH = `PATCH /agents/${draft.id}`;
    await expect(status(page)).toContainText('Brouillon enregistré');
    await expect(stepChip(page, 'identity')).toHaveAttribute('data-state', 'done');
    await expect(stepChip(page, 'knowledge')).toHaveAttribute('data-state', 'active');
    await expect(stepChip(page, 'behaviour')).toHaveAttribute('data-state', 'upcoming');
    await expect(railRow(page, 'MODÈLE')).toHaveText('Vendeur Pro');
    await expect(railRow(page, 'CONNAISSANCES')).toHaveText('Tout le catalogue · 2 règles · 3 FAQ');
    expect(agentWrites(rec)).toEqual([]); // opening a draft writes nothing

    // autosave: no click, one PATCH of the section a moment after the last key
    await page.getByLabel('RETOURS / ÉCHANGES').fill('Échange sous 7 jours si non porté');
    await expect(railRow(page, 'CONNAISSANCES')).toHaveText('Tout le catalogue · 3 règles · 3 FAQ');
    const [patch] = await expectWrites(rec, PATCH);
    const body = bodyOf(patch!) as { version?: number; step?: number; wizard?: { policies?: Record<string, string>; catalogScope?: string } };
    expect(body.version).toBe(draft.version);
    expect(body.step).toBeUndefined(); // an autosave never moves the wizard forward
    expect(body.wizard?.policies).toEqual({ ...POLICIES, returns: 'Échange sous 7 jours si non porté' });
    expect(body.wizard?.catalogScope).toBe('all');
    await expect(status(page)).toContainText('Brouillon enregistré');
    await expect(status(page)).toContainText('reprenable depuis la liste (statut Brouillon)');
    await expect.poll(async () => ((await getAgent(api(page), owner, draft.id)).wizard.policies as Record<string, string>).returns).toBe('Échange sous 7 jours si non porté');
    // saved once: nothing else is sent while the form is idle
    await page.waitForTimeout(2_500);
    expect(writesOf(rec, PATCH)).toHaveLength(1);

    // "Enregistrer et quitter"
    await page.getByLabel('HORAIRES / DÉLAI DE RÉPONSE HUMAINE').fill('Équipe disponible 9h–20h');
    await page.getByTestId('wizard-save-quit').click();
    await expect(toastOf(page, `Brouillon « ${DRAFT} » enregistré`)).toBeVisible(TOAST);
    await expectRoute(page, '**/fr/agents');
    const saved = await getAgent(api(page), owner, draft.id);
    expect((saved.wizard.policies as Record<string, string>).hours).toBe('Équipe disponible 9h–20h');
    expect(saved.status).toBe('draft');
    expect(saved.wizardStep).toBe(2);

    // the draft card resumes at the step after the last saved one (2 ⇒ step 3)
    const card = agentCard(page, draft.id);
    await expect(card).toHaveAttribute('data-state', 'draft', { timeout: 30_000 });
    await expect(card).toContainText('Brouillon · étape 3 / 5 · Comportement');
    await card.getByTestId('agent-resume-draft').click();
    await expectRoute(page, stepUrl('behaviour', draft.id));
    await expect(title(page, 'behaviour')).toBeVisible(NAV);
    await expect(stepChip(page, 'identity')).toHaveAttribute('data-state', 'done');
    await expect(stepChip(page, 'knowledge')).toHaveAttribute('data-state', 'done');
    await expect(stepChip(page, 'behaviour')).toHaveAttribute('data-state', 'active');
    await expect(stepChip(page, 'behaviour')).toHaveAttribute('aria-current', 'step');
    await expect(stepChip(page, 'channels')).toHaveAttribute('data-state', 'upcoming');
    await expect(stepChip(page, 'activate')).toHaveAttribute('data-state', 'upcoming');
    // steps not reached yet are not links; the earlier ones are
    await expect(stepChip(page, 'channels').getByRole('button')).toHaveCount(0);
    await expect(stepChip(page, 'activate').getByRole('button')).toHaveCount(0);

    // back to step 1 through the stepper: the saved values are there, the starting point is fixed
    await stepChip(page, 'identity').getByRole('button').click();
    await expectRoute(page, stepUrl('identity', draft.id));
    await expect(title(page, 'identity')).toBeVisible(NAV);
    await expect(stepChip(page, 'identity')).toHaveAttribute('data-state', 'active');
    await expect(stepChip(page, 'knowledge')).toHaveAttribute('data-state', 'done');
    await expect(page.getByLabel('NOM INTERNE')).toHaveValue(DRAFT);
    await expect(page.getByTestId('starting-point-fixed')).toHaveText('Modèle de départ : Vendeur Pro. Il ne se change plus une fois le brouillon créé.');
    await expect(page.getByTestId('starting-point').getByRole('radio')).toHaveCount(0);
    // and "Précédent" of a later step
    await stepChip(page, 'knowledge').getByRole('button').click();
    await expect(title(page, 'knowledge')).toBeVisible(NAV);
    await expect(page.getByLabel('HORAIRES / DÉLAI DE RÉPONSE HUMAINE')).toHaveValue('Équipe disponible 9h–20h');
    await page.getByTestId('wizard-back').click();
    await expectRoute(page, stepUrl('identity', draft.id));
  });

  test('409 on a step save opens "Modifié par quelqu\'un d\'autre": Recharger keeps the form, Écraser saves over', async ({ page }) => {
    const DRAFT = `Brouillon disputé ${RUN}`;
    await signInApi(page, owner);
    const draft = await draftAt(page, DRAFT, 2, { wizard: { policies: POLICIES } });
    const rec = await openWizard(page, 'knowledge', draft.id);
    const PATCH = `PATCH /agents/${draft.id}`;
    const returns = page.getByLabel('RETOURS / ÉCHANGES');
    const policiesOf = async () => (await getAgent(api(page), owner, draft.id)).wizard.policies as Record<string, string>;
    // a colleague saves the same draft through the API while the step is open: the page holds an older version
    const colleagueSaves = (description: string) => patchAgent(api(page), owner, draft.id, { description });

    // the merchant types, a colleague saves meanwhile (a form with unsaved changes is never rebased by the live event)
    await returns.fill('Échange sous 7 jours');
    await colleagueSaves('Changé par un collègue');
    await next(page).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: "Modifié par quelqu'un d'autre" })).toBeVisible();
    // the API names the author of the last version (the owner of this shop)
    await expect(dialog).toContainText(`Modifié par ${owner.firstName} ${owner.lastName}`);
    await expect(dialog).toContainText('votre brouillon est conservé.');
    await expect(dialog.getByRole('button', { name: 'Écraser', exact: true })).toBeVisible();
    expect(bodyOf(writesOf(rec, PATCH).at(-1)!).version).toBe(draft.version);
    // the step did not move and nothing was saved
    await expectRoute(page, stepUrl('knowledge', draft.id));
    expect((await policiesOf()).returns).toBeUndefined();

    // Recharger: the dialog closes, what was typed stays in the form (and its autosave then goes through)
    await dialog.getByRole('button', { name: 'Recharger', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(returns).toHaveValue('Échange sous 7 jours');
    await expect(title(page, 'knowledge')).toBeVisible();
    await expect.poll(async () => (await policiesOf()).returns, { timeout: 30_000 }).toBe('Échange sous 7 jours');
    const afterReload = await getAgent(api(page), owner, draft.id);
    expect((afterReload as unknown as { description: string | null }).description).toBe('Changé par un collègue'); // their section is kept as well
    await expect(status(page)).toContainText('Brouillon enregistré');

    // again, then Écraser: saved with the fresh version, the wizard moves on
    const before = writesOf(rec, PATCH).length;
    await returns.fill('Échange sous 10 jours');
    await colleagueSaves('Changé encore');
    const fresh = await getAgent(api(page), owner, draft.id);
    await next(page).click();
    await expect(dialog.getByRole('heading', { name: "Modifié par quelqu'un d'autre" })).toBeVisible();
    await dialog.getByRole('button', { name: 'Écraser', exact: true }).click();
    await expectRoute(page, stepUrl('behaviour', draft.id));
    await expect(title(page, 'behaviour')).toBeVisible(NAV);
    const last = bodyOf(writesOf(rec, PATCH).at(-1)!) as { version?: number; step?: number; wizard?: { policies?: Record<string, string> } };
    expect(writesOf(rec, PATCH).length).toBeGreaterThan(before + 1);
    expect(last.version).toBe(fresh.version);
    expect(last.step).toBe(2);
    expect(last.wizard?.policies?.returns).toBe('Échange sous 10 jours');
    expect((await policiesOf()).returns).toBe('Échange sous 10 jours');
  });
});

test.describe('step 2 — knowledge', () => {
  test('catalogue scope "Seulement certaines catégories" without a category is refused; axe', async ({ page }) => {
    await signInApi(page, owner);
    const draft = await draftAt(page, `Catalogue ${RUN}`, 2, { wizard: { policies: POLICIES } });
    const rec = await openWizard(page, 'knowledge', draft.id);
    const PATCH = `PATCH /agents/${draft.id}`;
    const scope = page.getByRole('radiogroup', { name: 'Catalogue' });
    await expect(scope.getByRole('radio', { name: /Tout le catalogue/ })).toBeChecked();
    // the real count of active products of the shop
    await expect(scope).toContainText(String(shop.products.length));
    await expect(page.getByTestId('scope-categories')).toHaveCount(0);
    await expectNoA11yViolations(page);

    // the shop has no category yet: "by category" is greyed with its reason and a link to Catégories
    expect(await realGet<unknown[]>(api(page), owner, '/categories')).toEqual([]);
    await expect(scope.getByRole('radio', { name: /Seulement certaines catégories/ })).toBeDisabled();
    await expect(page.getByTestId('scope-categories-disabled')).toBeVisible();
    await expect(page.getByTestId('scope-categories-disabled').getByRole('link')).toHaveAttribute('href', /\/categories$/);
    await expectNoA11yViolations(page);
    await page.waitForTimeout(2_500);
    expect(writesOf(rec, PATCH)).toEqual([]);

    // the whole catalogue is accepted
    await next(page).click();
    await expect(title(page, 'behaviour')).toBeVisible(NAV);
    const body = bodyOf(writesOf(rec, PATCH).at(-1)!) as { step?: number; wizard?: { catalogScope?: string; scopeCategoryIds?: string[] } };
    expect(body.step).toBe(2);
    expect(body.wizard?.catalogScope).toBe('all');
    expect((await getAgent(api(page), owner, draft.id)).wizard.catalogScope).toBe('all');
  });

  test('FAQ: the three source pills, add a question through the dialog, delete one', async ({ page }) => {
    await signInApi(page, owner);
    const draft = await draftAt(page, `FAQ ${RUN}`, 2, { wizard: { policies: POLICIES } });
    // SAISI: typed by the merchant
    await addFaq(api(page), owner, draft.id, 'Le parfum tient combien de temps ?', '8 à 10 heures sur peau, 24 h sur vêtement.');
    // EXTRAIT DE LA PAGE FB: a customer asked on the second page, the team answered, then the extraction ran
    const sender = nextSender();
    await inject(api(page), owner, { channelId: shop.facebook2.id, sender, text: 'Vous livrez à Tamanrasset ?' });
    const conversation = await conversationOf(api(page), owner, sender);
    await teamReplies(api(page), owner, conversation.id, 'Oui, 5 à 7 jours via ZR Express, 1 200 DA.');
    const { jobId } = await realPost<{ jobId: string }>(api(page), owner, `/agents/${draft.id}/faq/extract`, { channelId: shop.facebook2.id });
    expect((await waitJob(api(page), owner, jobId)).status).toBe('done');
    expect((await faqsOf(api(page), owner, draft.id)).map((f) => [f.question, f.source])).toEqual([
      ['Le parfum tient combien de temps ?', 'manual'],
      ['Vous livrez à Tamanrasset ?', 'page_extraction'],
    ]);
    // mock: a suggestion "SUGGÉRÉ PAR L'IA (n CLIENTS…)" is written only while a live agent answers customers
    // (`suggest_faq` never runs in a dry run), and a draft never answers: it is appended to the real list
    await patchAnswer(page, new RegExp(`/api/v1/agents/${draft.id}/faq$`), (rows: unknown[]) => [
      ...rows,
      { id: 'cccccccc-0000-7000-8000-000000000003', question: 'C’est original ?', answer: '', source: 'ai_suggested', askedCount: 12, sortOrder: 1000, isActive: false, createdAt: new Date().toISOString() },
    ]);
    const rec = await openWizard(page, 'knowledge', draft.id);
    const faq = page.locator('[data-section="faq"]');
    const rows = faq.getByRole('list', { name: 'FAQ & connaissances supplémentaires' }).getByRole('listitem');
    const row = (q: string) => rows.filter({ hasText: q });
    await expect(rows).toHaveCount(3, { timeout: 30_000 });
    await expect(faq.getByTestId('faq-count')).toHaveText('3 / 50');
    await expect(rows.nth(0)).toContainText('Le parfum tient combien de temps ?');
    await expect(rows.nth(0)).toContainText('8 à 10 heures sur peau, 24 h sur vêtement.');
    await expect(rows.nth(0)).toContainText('SAISI');
    await expect(rows.nth(1)).toContainText('Vous livrez à Tamanrasset ?');
    await expect(rows.nth(1)).toContainText('Oui, 5 à 7 jours via ZR Express, 1 200 DA.');
    await expect(rows.nth(1)).toContainText('EXTRAIT DE LA PAGE FB');
    await expect(rows.nth(2)).toContainText("SUGGÉRÉ PAR L'IA (12 CLIENTS L'ONT DEMANDÉ)");

    // add: both fields are required
    await faq.getByTestId('faq-add').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Ajouter une question' })).toBeVisible();
    await dialog.getByTestId('faq-save').click();
    await expect(dialog.getByText('Champ requis')).toHaveCount(2);
    expect(agentWrites(rec)).toEqual([]);
    await dialog.getByLabel('QUESTION').fill('Vous faites des coffrets cadeaux ?');
    await dialog.getByLabel('RÉPONSE').fill('Oui, emballage cadeau offert dès 2 articles.');
    await dialog.getByTestId('faq-save').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writesOf(rec, `POST /agents/${draft.id}/faq`).map(bodyOf)).toEqual([{ question: 'Vous faites des coffrets cadeaux ?', answer: 'Oui, emballage cadeau offert dès 2 articles.' }]);
    await expect(rows).toHaveCount(4);
    await expect(row('Vous faites des coffrets cadeaux ?')).toContainText('Oui, emballage cadeau offert dès 2 articles.');
    await expect(row('Vous faites des coffrets cadeaux ?')).toContainText('SAISI');
    await expect(faq.getByTestId('faq-count')).toHaveText('4 / 50');

    // delete: asked first (the row is removed on the server at once, outside "Annuler les modifications")
    await faq.getByRole('button', { name: 'Supprimer « Vous livrez à Tamanrasset ? »' }).click();
    const confirmRemove = page.getByRole('dialog');
    await expect(confirmRemove.getByRole('heading', { name: 'Supprimer cette question ?' })).toBeVisible();
    expect(rec.writes.filter((x) => x.startsWith(`DELETE /agents/${draft.id}/faq/`))).toHaveLength(0);
    await confirmRemove.getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rows).toHaveCount(3);
    await expect(faq).not.toContainText('Vous livrez à Tamanrasset ?');
    await expect(faq).not.toContainText('EXTRAIT DE LA PAGE FB');
    await expect(faq.getByTestId('faq-count')).toHaveText('3 / 50');
    expect(rec.writes.filter((x) => x.startsWith(`DELETE /agents/${draft.id}/faq/`))).toHaveLength(1);
    expect((await faqsOf(api(page), owner, draft.id)).map((f) => f.question)).toEqual(['Le parfum tient combien de temps ?', 'Vous faites des coffrets cadeaux ?']);
    // FAQ rows are saved one by one: the draft itself was not touched
    expect(writesOf(rec, `PATCH /agents/${draft.id}`)).toEqual([]);
  });
});

test.describe('step 3 — behaviour', () => {
  test('locked order fields, max quantity, keyword rule, business hours, response delay, product-card preview; axe', async ({ page }) => {
    await signInApi(page, owner);
    const draft = await draftAt(page, `Comportement ${RUN}`, 2, { wizard: { policies: POLICIES } });
    const routes = await realGet<{ capability: string; model: { label: string } }[]>(api(page), owner, '/ai/routes');
    const rec = await openWizard(page, 'behaviour', draft.id);
    const PATCH = `PATCH /agents/${draft.id}`;
    // the model assigned by the platform routing (read-only)
    await expect(page.getByTestId('model-badge').first()).toHaveText(routes.find((r) => r.capability === 'text')!.model.label);

    // order fields: the five mandatory ones are checked and cannot be unchecked
    const chip = (key: string) => page.locator(`label[data-chip="${key}"]`).getByRole('checkbox');
    for (const key of ['product', 'quantity', 'name', 'phone', 'wilaya']) {
      await expect(chip(key)).toBeChecked();
      await expect(chip(key)).toBeDisabled();
      await expect(page.locator(`label[data-chip="${key}"]`)).toHaveAttribute('title', 'Obligatoire : ne se désactive pas');
    }
    for (const key of ['commune', 'address']) {
      await expect(chip(key)).toBeChecked();
      await expect(chip(key)).toBeEnabled();
    }
    await expect(chip('phone2')).not.toBeChecked();
    await expectNoA11yViolations(page);
    await chip('note').check();

    // max quantity 0 (a new draft has no maximum yet)
    const qty = page.getByLabel('QUANTITÉ MAX PAR COMMANDE');
    const savedQty = draft.wizard.maxQtyPerOrder as number | null;
    await expect(qty).toHaveValue(savedQty === null ? '' : String(savedQty));
    await qty.fill('0');
    await next(page).click();
    await expect(summary(page)).toContainText('Validation : 1 erreur');
    await expect(summary(page)).toContainText(/La quantité max doit être ≥ 1 \(et ≤ 1\s?000\)\./);
    await expect(qty).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[data-section="order"]')).toContainText(/La quantité max doit être ≥ 1/);
    await qty.fill('8');
    await expect(summary(page)).toHaveCount(0);

    // keyword rule without keyword
    const rule = page.locator('label[data-rule="keyword"]').getByRole('checkbox');
    await expect(rule).not.toBeChecked();
    await expect(page.getByTestId('tag-input')).toHaveCount(0);
    await rule.check();
    const tags = page.getByTestId('tag-input');
    await expect(tags).toBeVisible();
    await next(page).click();
    await expect(summary(page)).toContainText('Ajoutez au moins un mot-clé, ou décochez la règle « mot-clé ».');
    await expect(tags).toHaveAttribute('aria-invalid', 'true');
    await expectRoute(page, stepUrl('behaviour', draft.id));
    expect(writesOf(rec, PATCH)).toEqual([]);
    const input = page.getByRole('textbox', { name: 'MOTS-CLÉS DE TRANSFERT' });
    await input.fill('arnaque');
    await input.press('Enter');
    await expect(tags.locator('[data-tag="arnaque"]')).toBeVisible();
    await expect(input).toHaveValue('');
    await expect(summary(page)).toHaveCount(0);
    await expect(tags).not.toHaveAttribute('aria-invalid', 'true');
    await input.fill('avocat,');
    await expect(tags.locator('[data-tag]')).toHaveCount(2);
    // the rules of the draft as drawn (7 rows): the API switches every rule on, the keyword rule is now on too
    const checked = await page.locator('label[data-rule]').getByRole('checkbox', { checked: true }).count();
    expect(checked).toBe(7);
    await expect(railRow(page, 'TRANSFERT')).toHaveText(`${checked} règles + 2 mots-clés`);

    // business hours: the editor appears with the toggle
    const editor = page.getByTestId('schedule-editor');
    await expect(editor.getByRole('group', { name: "Jours d'ouverture" })).toHaveCount(0);
    await editor.getByRole('switch', { name: "Horaires d'ouverture" }).click();
    const days = editor.getByRole('group', { name: "Jours d'ouverture" });
    await expect(days.getByRole('button')).toHaveCount(7);
    await expect(days.getByRole('button').first()).toHaveText('Sam'); // the week starts on Saturday
    await expect(days.getByRole('button', { name: 'Ven' })).toHaveAttribute('aria-pressed', 'false');
    await expect(days.getByRole('button', { name: 'Lun' })).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.getByLabel('DE', { exact: true })).toHaveValue('09:00');
    await expect(editor.getByLabel('À', { exact: true })).toHaveValue('20:00');
    await editor.getByLabel('À', { exact: true }).fill('08:00');
    await next(page).click();
    await expect(summary(page)).toContainText("L'heure de fin doit être après l'heure de début.");
    await editor.getByLabel('À', { exact: true }).fill('21:30');

    // response delay: the preset's own delay
    const delay = page.getByRole('slider', { name: 'DÉLAI DE RÉPONSE' });
    const vendeur = presets.find((p) => p.key === 'vendeur-pro')!;
    await expect(delay).toHaveValue(String(vendeur.responseDelaySec));
    await expect(page.locator('output[for="agent-delay"]')).toHaveText(`${vendeur.responseDelaySec} s (naturel)`);
    await delay.fill('0');
    await expect(page.locator('output[for="agent-delay"]')).toHaveText('immédiat');
    await delay.fill('6');
    await expect(page.locator('output[for="agent-delay"]')).toHaveText('6 s (naturel)');
    await expect(delay).toHaveAttribute('aria-valuetext', '6 s (naturel)');

    // product card template: live preview with a sample product
    const preview = page.getByTestId('template-preview');
    await expect(preview).toHaveText("Sans modèle, l'agent rédige librement.");
    await page.getByLabel('MODÈLE DE CARTE PRODUIT').fill('[PRODUCT_CARD] {name} — {price} · {description} ({stock} en stock)');
    await expect(preview).toHaveText(/^La Robe satin — 4\s900\sDA · Satin fluide, coupe droite \(7 en stock\)$/);

    // the whole section is sent with the step, and the API keeps it
    await next(page).click();
    await expect(title(page, 'channels')).toBeVisible(NAV);
    const body = bodyOf(writesOf(rec, PATCH).at(-1)!) as { step?: number; version?: number; responseDelaySec?: number; productCardTemplate?: string; wizard?: { maxQtyPerOrder?: number; handoffKeywords?: string[]; businessHours?: { from: string; to: string; days: number[] }; orderFields?: { key: string; required: boolean }[]; handoffRules?: { kind: string; enabled: boolean }[] } };
    expect(body.step).toBe(3);
    expect(body.version).toBe(draft.version);
    expect(body.responseDelaySec).toBe(6);
    expect(body.productCardTemplate).toBe('[PRODUCT_CARD] {name} — {price} · {description} ({stock} en stock)');
    expect(body.wizard?.maxQtyPerOrder).toBe(8);
    expect(body.wizard?.handoffKeywords).toEqual(['arnaque', 'avocat']);
    expect(body.wizard?.businessHours).toEqual({ days: [0, 1, 2, 3, 4, 6], from: '09:00', to: '21:30' });
    expect(body.wizard?.orderFields?.filter((f) => f.required).map((f) => f.key)).toEqual(['product', 'quantity', 'name', 'phone', 'wilaya', 'commune', 'address', 'note']);
    expect(body.wizard?.handoffRules?.find((r) => r.kind === 'keyword')?.enabled).toBe(true);
    const saved = await getAgent(api(page), owner, draft.id);
    expect(saved.wizardStep).toBe(3);
    expect(saved.wizard).toMatchObject({ maxQtyPerOrder: 8, handoffKeywords: ['arnaque', 'avocat'], businessHours: { days: [0, 1, 2, 3, 4, 6], from: '09:00', to: '21:30' } });
    expect((saved as unknown as { responseDelaySec: number; productCardTemplate: string }).responseDelaySec).toBe(6);
    expect((saved.wizard.orderFields as { key: string; required: boolean }[]).find((f) => f.key === 'note')?.required).toBe(true);
    await expect(stepChip(page, 'behaviour')).toHaveAttribute('data-state', 'done');
  });
});

test.describe('step 4 — channels', () => {
  const option = (page: Page, id: string) => page.locator(`[data-testid="channel-option"][data-channel="${id}"]`);

  test('AT-AGT-04 a page linked to another agent asks before moving; a free page is linked in one click; a page to reconnect cannot be linked; axe', async ({ page }) => {
    const DRAFT = `Canaux ${RUN}`;
    const OTHER = `Vendeur Pro ${RUN}`;
    await signInApi(page, owner);
    const other = await createAgent(api(page), owner, { name: OTHER });
    const draft = await draftAt(page, DRAFT, 3, { wizard: { policies: POLICIES } });
    const [fb, ig, fb2] = [shop.facebook, shop.instagram, shop.facebook2];
    // the first page answers with another agent, the Instagram account is free
    await linkPage(api(page), owner, fb.id, other.id);
    await linkPage(api(page), owner, ig.id, null);
    await linkPage(api(page), owner, fb2.id, null);
    // mock: a page "à reconnecter" needs Meta to refuse its token, and the fake Meta adapter has no HTTP switch for
    // that: the second page of the real list is answered with the `needs_reconnect` status
    await patchAnswer(page, /\/api\/v1\/channels(\?.*)?$/, (rows: { id: string; status: string }[]) => rows.map((c) => (c.id === fb2.id ? { ...c, status: 'needs_reconnect' } : c)));
    const rec = await openWizard(page, 'channels', draft.id);
    await expect(page.getByTestId('channel-option')).toHaveCount(3, { timeout: 30_000 });
    await expect(page.locator('[data-section="channels"]')).toHaveAttribute('data-selected', '0');
    await expect(page.locator('[data-section="channels"]')).toContainText("Le changement s'applique aux nouvelles conversations.");
    await expectNoA11yViolations(page);

    // linked elsewhere: never moved silently
    const first = option(page, fb.id);
    await expect(first).toHaveAttribute('data-state', 'linked_elsewhere');
    await expect(first).toContainText(`LIÉE À « ${OTHER} »`);
    await expect(first.getByTestId('channel-move')).toHaveText('Déplacer ici');
    await expect(first.getByRole('checkbox', { name: `Cet agent répond sur ${fb.name}` })).not.toBeChecked();
    await first.getByTestId('channel-move').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: `Déplacer « ${fb.name} » vers « ${DRAFT} » ?` })).toBeVisible();
    await expect(dialog.getByTestId('move-dialog')).toContainText(`« ${OTHER} » ne répondra plus sur cette page.`);
    await expect(dialog.getByTestId('move-dialog')).toContainText(errText('AGENT_CHANNEL_SWITCH_NEXT_THREAD'));

    // Annuler ⇒ nothing is written
    await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(agentWrites(rec)).toEqual([]);
    await expect(first).toHaveAttribute('data-state', 'linked_elsewhere');

    // confirm ⇒ PUT with move: true
    await first.getByTestId('channel-move').click();
    await dialog.getByTestId('move-confirm').click();
    await expect(toastOf(page, `« ${fb.name} » rattachée à ${DRAFT}`)).toBeVisible(TOAST);
    expect(writesOf(rec, `PUT /channels/${fb.id}/agent`).map(bodyOf)).toEqual([{ agentId: draft.id, move: true }]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(first).toHaveAttribute('data-state', 'selected');
    await expect(first).toContainText('SÉLECTIONNÉE');
    await expect(first.getByTestId('channel-move')).toHaveCount(0);
    await expect(first.getByRole('checkbox', { name: `Cet agent répond sur ${fb.name}` })).toBeChecked();
    await expect(railRow(page, 'CANAUX')).toHaveText(`${fb.name} (FB)`);
    // the other agent lost the page
    expect((await getAgent(api(page), owner, other.id)).channels).toEqual([]);

    // free page: one click, no dialog, no `move`
    const insta = option(page, ig.id);
    await expect(insta).toHaveAttribute('data-state', 'free');
    await expect(insta).toContainText('INSTAGRAM');
    await insta.getByRole('checkbox', { name: `Cet agent répond sur ${ig.name}` }).click(); // controlled: checked once the server answered
    await expect(toastOf(page, `« ${ig.name} » rattachée à ${DRAFT}`)).toBeVisible(TOAST);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writesOf(rec, `PUT /channels/${ig.id}/agent`).map(bodyOf)).toEqual([{ agentId: draft.id }]);
    await expect(insta).toHaveAttribute('data-state', 'selected');
    await expect(page.locator('[data-section="channels"]')).toHaveAttribute('data-selected', '2');
    await expect(railRow(page, 'CANAUX')).toHaveText(`${fb.name} (FB) · ${ig.name} (IG)`);
    expect((await getAgent(api(page), owner, draft.id)).channels.map((c) => c.id).sort()).toEqual([fb.id, ig.id].sort());

    // needs reconnect: greyed, cannot be linked
    const outlet = option(page, fb2.id);
    await expect(outlet).toHaveAttribute('data-state', 'reconnect');
    await expect(outlet).toContainText('À RECONNECTER');
    await expect(outlet.getByRole('checkbox', { name: `Cet agent répond sur ${fb2.name}` })).toBeDisabled();
    await expect(outlet.getByRole('link', { name: 'Reconnecter' })).toHaveAttribute('href', `/fr/channels/${fb2.id}`);
    await expect(outlet.getByTestId('channel-move')).toHaveCount(0);

    // unlinking is one click too
    await insta.getByRole('checkbox', { name: `Cet agent répond sur ${ig.name}` }).click();
    await expect(toastOf(page, `Agent détaché de « ${ig.name} »`)).toBeVisible(TOAST);
    expect(bodyOf(writesOf(rec, `PUT /channels/${ig.id}/agent`).at(-1)!)).toEqual({ agentId: null });
    await expect(insta).toHaveAttribute('data-state', 'free');

    // step 4 has no field of its own: "Continuer" only records the step
    await next(page).click();
    await expect(title(page, 'activate')).toBeVisible(NAV);
    expect(bodyOf(writesOf(rec, `PATCH /agents/${draft.id}`).at(-1)!)).toEqual({ step: 4, version: draft.version });
    const saved = await getAgent(api(page), owner, draft.id);
    expect(saved.wizardStep).toBe(4);
    expect(saved.channels.map((c) => c.id)).toEqual([fb.id]);
  });
});

test.describe('step 5 — test & activation', () => {
  const scenario = (page: Page, key: string) => page.locator(`[data-section="scenarios"] li[data-scenario="${key}"]`);
  const check = (page: Page, key: string) => page.locator(`[data-section="readiness"] li[data-check="${key}"]`);
  const SCENARIO_KEYS = ['darija_price', 'arabizi_delivery', 'photo', 'voice', 'off_catalog', 'anger', 'qty_limit', 'refund'];

  test('readiness checklist, the 8 scenarios, embedded playground, test link, "Enregistrer en brouillon"; axe', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const DRAFT = `Test et activation ${RUN}`;
    await signInApi(page, owner);
    const draft = await draftAt(page, DRAFT, 4, { wizard: { policies: { ...POLICIES, returns: 'Échange sous 7 jours' } } });
    await linkPage(api(page), owner, shop.instagram.id, draft.id);
    const readiness = await readinessOf(api(page), owner, draft.id);
    const rec = await openWizard(page, 'activate', draft.id);

    // readiness: the checks of the API, ✓ / ⚠ / missing, with their links
    const ready = page.locator('[data-section="readiness"]');
    await expect(ready.getByRole('heading', { name: 'Prêt à activer ?' })).toBeVisible();
    await expect(ready.locator('li[data-check]')).toHaveCount(readiness.checks.length, { timeout: 30_000 });
    expect(readiness.ready).toBe(true);
    await expect(ready).toHaveAttribute('data-ready', 'true');
    for (const c of readiness.checks) {
      await expect(check(page, c.key)).toHaveAttribute('data-state', c.ok ? 'ok' : c.blocking ? 'missing' : 'warning');
      await expect(check(page, c.key)).toContainText(c.label);
    }
    for (const key of ['catalog', 'policies', 'channels', 'emailVerified', 'credits']) await expect(check(page, key)).toHaveAttribute('data-state', 'ok');
    // since M5 every new workspace gets its 58-row fee grid at creation (DLV-01): ok; products without photo: warning, not blocking
    await expect(check(page, 'feeGrid')).toHaveAttribute('data-state', 'ok');
    await expect(check(page, 'productsWithoutPhoto')).toHaveAttribute('data-state', 'warning');
    await expect(check(page, 'catalog').getByRole('link', { name: 'Voir' })).toHaveAttribute('href', '/fr/products');
    await expect(page.getByTestId('activation-error')).toHaveCount(0);

    // the 8 scenarios, never run yet on this draft
    const list = page.locator('[data-section="scenarios"]');
    await expect(list.getByRole('heading', { name: 'Scénarios de test automatiques' })).toBeVisible();
    await expect(list.locator('li[data-scenario]')).toHaveCount(8);
    for (const key of SCENARIO_KEYS) {
      await expect(scenario(page, key)).toHaveAttribute('data-status', 'none');
      await expect(scenario(page, key)).toContainText('pas encore lancé');
    }
    await expect(scenario(page, 'darija_price')).toContainText('Darija');
    await expect(list.getByTestId('scenario-open')).toHaveCount(8);

    // the rail of step 5: three ways out
    const rail = page.getByTestId('activation-rail');
    await expect(rail.getByTestId('activate-now')).toHaveText('Activer maintenant');
    await expect(rail.getByTestId('activate-save-draft')).toHaveText('Enregistrer en brouillon');
    await expect(rail.getByTestId('activate-later')).toHaveText('Activer à une date (ex. lancement)');
    await expect(rail).toContainText(errText('AGENT_CHANNEL_SWITCH_NEXT_THREAD'));
    await expect(railRow(page, 'CANAUX')).toHaveText(`${shop.instagram.name} (IG)`);
    await expect(status(page)).toContainText('Activation bloquée si : aucun canal libre');
    await expect(next(page)).toHaveCount(0);
    await expectNoA11yViolations(page);
    expect(agentWrites(rec)).toEqual([]);

    // "Ouvrir ›" runs that scenario in the embedded playground (the wizard stays where it is): a real dry-run turn
    await scenario(page, 'darija_price').getByTestId('scenario-open').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: `Bac à essai · ${DRAFT}` })).toBeVisible();
    const playground = dialog.getByTestId('embedded-playground');
    await expect(playground.getByTestId('playground-banner')).toContainText('SIMULATION');
    await expect(playground.getByTestId('playground-turn')).toHaveCount(1, { timeout: 60_000 });
    const turnStatus = await playground.getByTestId('playground-turn').getAttribute('data-status');
    expect(turnStatus).toMatch(/^[A-Z_]+$/);
    await expect(playground.getByTestId('playground-turn').locator('[data-message="ai"]')).toBeVisible();
    await expect(playground.getByTestId('inspector').locator('[data-row="status"]')).toContainText(turnStatus!);
    const tests = writesOf(rec, `POST /agents/${draft.id}/test`);
    expect(tests).toHaveLength(1);
    expect(bodyOf(tests[0]!).scenario).toBe('darija_price');
    expect(bodyOf(tests[0]!).messages).toEqual([]);
    await dialog.getByRole('button', { name: 'Fermer' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectRoute(page, stepUrl('activate', draft.id));

    // "Relancer les 8 scénarios": the job runs on the worker, then every row shows its result
    await expect(list.getByTestId('scenarios-run')).toHaveText('Relancer les 8 scénarios');
    await list.getByTestId('scenarios-run').click();
    await expectWrites(rec, `POST /agents/${draft.id}/test-scenarios`);
    await expect.poll(async () => (await scenariosOf(api(page), owner, draft.id)).every((s) => s.status !== null), { timeout: 120_000 }).toBe(true);
    // the button comes back once the page saw the job end
    await expect(list.getByTestId('scenarios-run')).toBeEnabled({ timeout: 60_000 });
    await expect(list.getByTestId('scenarios-run')).toHaveText('Relancer les 8 scénarios');
    const results = await scenariosOf(api(page), owner, draft.id);
    for (const s of results) {
      await expect(scenario(page, s.scenarioKey)).toHaveAttribute('data-status', s.status!, { timeout: 30_000 });
      await expect(scenario(page, s.scenarioKey)).toContainText(s.status === 'pass' ? '✓' : s.status === 'fail' ? '✕' : '⚠');
      if (s.summary) await expect(scenario(page, s.scenarioKey)).toContainText(s.summary.slice(0, 40));
    }

    // "Tester moi-même": the same dialog, empty, nothing sent until the merchant writes
    await list.getByTestId('wizard-test-myself').click();
    await expect(playground).toBeVisible();
    await expect(playground.getByTestId('playground-thread')).toContainText('Écrivez comme un client (darija, arabizi, français) ou lancez un scénario');
    await expect(playground.getByTestId('playground-turn')).toHaveCount(0);
    expect(writesOf(rec, `POST /agents/${draft.id}/test`)).toHaveLength(1);
    await playground.getByRole('textbox', { name: 'Écrire comme un client… (darija, arabizi, français)' }).fill('salam, kayen robe satin ?');
    await playground.getByTestId('playground-send').click();
    await expect(playground.getByTestId('playground-turn')).toHaveCount(1, { timeout: 60_000 });
    // the fake model finds the product of the shop and sends its card
    await expect(playground.getByTestId('playground-turn')).toContainText(/Robe satin/i);
    const mine = bodyOf(writesOf(rec, `POST /agents/${draft.id}/test`).at(-1)!) as { scenario?: string; messages?: { role: string; text: string }[] };
    expect(mine.scenario).toBeUndefined();
    expect(mine.messages).toEqual([{ role: 'user', text: 'salam, kayen robe satin ?' }]);
    await dialog.getByRole('button', { name: 'Fermer' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // test link for a colleague: a real 24 h link
    await list.getByTestId('wizard-test-link').click();
    await expect(dialog.getByRole('heading', { name: 'Lien de test' })).toBeVisible();
    await dialog.getByTestId('test-link-create').click();
    await expect(dialog.getByLabel('LIEN À PARTAGER')).toHaveValue(/^http:\/\/localhost:3010\/(fr\/)?agent-test\/[A-Za-z0-9_-]{16,}$/);
    expect(writesOf(rec, `POST /agents/${draft.id}/test-links`)).toHaveLength(1);
    await dialog.getByTestId('test-link-copy').click();
    await expect(toastOf(page, 'Copié')).toBeVisible(TOAST);
    await dialog.getByRole('button', { name: 'Fermer' }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // "Enregistrer en brouillon" ⇒ back to the list, still a draft
    await rail.getByTestId('activate-save-draft').click();
    await expect(toastOf(page, `Brouillon « ${DRAFT} » enregistré`)).toBeVisible(TOAST);
    await expectRoute(page, '**/fr/agents');
    await expect(agentCard(page, draft.id)).toHaveAttribute('data-state', 'draft', { timeout: 30_000 });
    expect(writesOf(rec, `POST /agents/${draft.id}/activate`)).toEqual([]);
    expect((await getAgent(api(page), owner, draft.id)).status).toBe('draft');
  });

  test('activation errors: AGENT_NO_CHANNEL inline, AGENT_DRAFT_INCOMPLETE checklist, PLAN_LIMIT dialog — then success lands on the agent page', async ({ page }) => {
    const DRAFT = `Activation ${RUN}`;
    await signInApi(page, owner);
    const draft = await draftAt(page, DRAFT, 4);
    // the draft answers on no page yet
    for (const c of [shop.facebook, shop.facebook2, shop.instagram]) await linkPage(api(page), owner, c.id, null);
    const helpers: string[] = [];
    try {
      const rec = await openWizard(page, 'activate', draft.id);
      const readiness = await readinessOf(api(page), owner, draft.id);
      const ready = page.locator('[data-section="readiness"]');
      await expect(ready.locator('li[data-check]')).toHaveCount(readiness.checks.length, { timeout: 30_000 });
      expect(readiness.ready).toBe(false);
      await expect(ready).toHaveAttribute('data-ready', 'false');
      await expect(check(page, 'channels')).toHaveAttribute('data-state', 'missing');
      // no shop rules on this draft: a warning (the API does not block on it)
      await expect(check(page, 'policies')).toHaveAttribute('data-state', 'warning');
      const activate = page.getByTestId('activate-now');
      const error = page.getByTestId('activation-error');
      const activations = () => writesOf(rec, `POST /agents/${draft.id}/activate`);

      // 1. draft without any page: the blocking row (✕) greys "Activer maintenant" and "Activer à une date" with what
      // to fix — nothing is sent (the API would answer AGENT_NO_CHANNEL)
      await expect(activate).toBeDisabled();
      await expect(activate).toHaveAttribute('title', new RegExp(escapeRe(label0(readiness, 'channels'))));
      await expect(page.getByTestId('activate-later')).toBeDisabled();
      await expect(page.getByTestId('activation-blocked')).toContainText(label0(readiness, 'channels'));
      await expect(error).toHaveCount(0);
      expect(activations()).toEqual([]);
      await expectRoute(page, stepUrl('activate', draft.id));

      // 2. the server lists what is missing (the page is linked meanwhile: the screen reads the readiness again)
      await linkPage(api(page), owner, shop.instagram.id, draft.id);
      await page.reload();
      await expect(check(page, 'channels')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });
      await expect(activate).toBeEnabled();
      // mock: the API reports AGENT_DRAFT_INCOMPLETE only for a draft without a name, and every write refuses an empty
      // name (VALIDATION_ERROR): the next activation is answered with the error the API would send
      await failOnce(page, new RegExp(`/api/v1/agents/${draft.id}/activate$`), 'POST', 422, 'AGENT_DRAFT_INCOMPLETE', 'Complétez : policies, channels.', { params: { 'missing[]': 'policies, channels' }, details: { missing: ['policies', 'channels'] } });
      await activate.click();
      await expect(error).toHaveAttribute('data-code', 'AGENT_DRAFT_INCOMPLETE');
      await expect(error).toContainText("Complétez avant d'activer :");
      await expect(error).toContainText(errText('AGENT_DRAFT_INCOMPLETE'));
      const missing = page.getByTestId('activation-missing').getByRole('listitem');
      await expect(missing).toHaveCount(2);
      // each missing key is named with the label of the real readiness check
      const label = (key: string) => readiness.checks.find((c) => c.key === key)!.label;
      await expect(page.getByTestId('activation-missing').locator('[data-missing="policies"]')).toHaveText(label('policies'));
      await expect(page.getByTestId('activation-missing').locator('[data-missing="channels"]')).toHaveText(label('channels'));
      // the readiness was read again: the page is linked now
      await expect(check(page, 'channels')).toHaveAttribute('data-state', 'ok', { timeout: 30_000 });

      // 3. plan limit (Pro trial: 5 agents; active and paused count, drafts never): the shop fills its slots
      const counted = (await listAgents(api(page), owner)).filter((a) => a.status === 'active' || a.status === 'paused').length;
      for (let i = counted; i < 5; i++) helpers.push((await activeAgent(api(page), owner, { name: `Occupant ${i + 1} ${RUN}`, channelId: shop.facebook2.id })).id);
      await activate.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: "Limite d'agents atteinte" })).toBeVisible();
      await expect(dialog.getByTestId('agents-limit-dialog')).toContainText(errText('PLAN_LIMIT'));
      await expect(dialog.getByTestId('limit-create-draft')).toHaveCount(0); // already a draft
      await dialog.getByRole('button', { name: 'Fermer' }).last().click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(error).toHaveAttribute('data-code', 'PLAN_LIMIT');
      await expect(page.getByTestId('activation-missing')).toHaveCount(0);
      expect((await getAgent(api(page), owner, draft.id)).status).toBe('draft');

      // 4. a slot is freed (one agent deleted): success
      await deleteAgent(api(page), owner, helpers.pop()!);
      await activate.click();
      await expect(toastOf(page, `Agent « ${DRAFT} » activé : il répond dès le prochain message.`)).toBeVisible(TOAST);
      expect(activations()).toHaveLength(3);
      await expectRoute(page, new RegExp(`/fr/agents/${draft.id}$`));
      const saved = await getAgent(api(page), owner, draft.id);
      expect(saved.status).toBe('active');
      expect(saved.channels.map((c) => c.id)).toEqual([shop.instagram.id]);
    } finally {
      // the next tests need free slots
      for (const id of helpers) await deleteAgent(api(page), owner, id).catch(() => undefined);
      if ((await getAgent(api(page), owner, draft.id)).status !== 'draft') await deleteAgent(api(page), owner, draft.id);
    }
  });

  test('"Activer à une date": a past date is refused, a future one schedules the activation and returns to the list', async ({ page }) => {
    const DRAFT = `Lancement ${RUN}`;
    await signInApi(page, owner);
    const draft = await draftAt(page, DRAFT, 4, { wizard: { policies: POLICIES } });
    await linkPage(api(page), owner, shop.facebook2.id, draft.id);
    const rec = await openWizard(page, 'activate', draft.id);
    const readiness = await readinessOf(api(page), owner, draft.id);
    await expect(page.locator('[data-section="readiness"] li[data-check]')).toHaveCount(readiness.checks.length, { timeout: 30_000 });
    await expect(page.getByTestId('activation-scheduled')).toHaveCount(0);

    await page.getByTestId('activate-later').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Activer à une date' })).toBeVisible();
    await expect(dialog).toContainText("L'agent reste en brouillon et s'active automatiquement à la date choisie (heure d'Algérie).");
    const at = dialog.getByLabel('DATE ET HEURE');

    // empty, then past
    await dialog.getByTestId('activate-at-submit').click();
    await expect(dialog.getByText('Choisissez une date dans le futur.')).toBeVisible();
    await at.fill('2020-01-01T10:00');
    await dialog.getByTestId('activate-at-submit').click();
    await expect(dialog.getByText('Choisissez une date dans le futur.')).toBeVisible();
    await expect(at).toHaveAttribute('aria-invalid', 'true');
    expect(agentWrites(rec)).toEqual([]);

    // future (Africa/Algiers = UTC+1)
    await at.fill('2031-01-15T10:30');
    await dialog.getByTestId('activate-at-submit').click();
    await expect(toastOf(page, `Activation de « ${DRAFT} » programmée.`)).toBeVisible(TOAST);
    expect(writesOf(rec, `POST /agents/${draft.id}/activate`).map(bodyOf)).toEqual([{ at: '2031-01-15T09:30:00.000Z' }]);
    await expectRoute(page, '**/fr/agents');
    // still a draft until that date, the API holds the date
    await expect(agentCard(page, draft.id)).toHaveAttribute('data-state', 'draft', { timeout: 30_000 });
    const saved = (await getAgent(api(page), owner, draft.id)) as unknown as { status: string; scheduledActivateAt: string | null };
    expect(saved.status).toBe('draft');
    expect(saved.scheduledActivateAt).toBe('2031-01-15T09:30:00.000Z');

    // back on step 5: the date input refuses the past (`min` = now) and the schedule can be cancelled
    const rec2 = await openWizard(page, 'activate', draft.id);
    await expect(page.getByTestId('activation-scheduled')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('activate-later').click();
    await expect(page.getByRole('dialog').getByLabel('DATE ET HEURE')).toHaveAttribute('min', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
    await page.getByTestId('activation-unschedule').click();
    await expect(toastOf(page, `Activation de « ${DRAFT} » annulée : l'agent reste en brouillon.`)).toBeVisible(TOAST);
    expect(writesOf(rec2, `DELETE /agents/${draft.id}/activate`)).toHaveLength(1);
    await expect(page.getByTestId('activation-scheduled')).toHaveCount(0);
    expect(((await getAgent(api(page), owner, draft.id)) as unknown as { scheduledActivateAt: string | null }).scheduledActivateAt).toBeNull();
  });
});

test.describe('RTL and small screens', () => {
  for (const size of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    test(`AT-UX-02 the wizard in Arabic at ${size.width}×${size.height} is right-to-left: step chips, footer, no horizontal overflow, numbers stay left-to-right`, async ({ page }) => {
      await page.setViewportSize(size);
      await signInApi(page, owner);
      const draft = await draftAt(page, `RTL ${size.width} ${RUN}`, 2, { wizard: { policies: POLICIES } });
      await enter(page, '/ar/agents/new', () => page.getByTestId('wizard-footer'));
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
      await expect(page.getByTestId('starting-point').getByRole('radio')).toHaveCount(5, { timeout: 30_000 });

      // step chips: five, numbered with left-to-right Latin digits, the first one on the right
      const chips = page.locator('li[data-step]');
      await expect(chips).toHaveCount(5);
      await expect(chips.locator('bdi[dir="ltr"]')).toHaveText(['1', '2', '3', '4', '5']);
      for (const chip of await chips.all()) await expect(chip).toBeVisible();
      const first = (await chips.nth(0).boundingBox())!;
      const second = (await chips.nth(1).boundingBox())!;
      if (Math.abs(first.y - second.y) < 4) expect(first.x).toBeGreaterThan(second.x);
      else expect(first.y).toBeLessThan(second.y); // stacked on a phone: the first one on top

      // footer: cancel on the start side (right), "continue" on the end side (left)
      const footer = page.getByTestId('wizard-footer');
      await expect(footer).toBeInViewport();
      await expect(footer.getByTestId('wizard-next')).toBeVisible();
      await expect(footer.getByTestId('wizard-save-quit')).toBeVisible();
      const cancel = (await footer.getByTestId('wizard-cancel').boundingBox())!;
      const go = (await footer.getByTestId('wizard-next').boundingBox())!;
      if (Math.abs(cancel.y - go.y) < 4) expect(cancel.x).toBeGreaterThan(go.x);

      // summary rail: the estimate is an isolated run with Latin digits only
      const rail = page.getByTestId('summary-rail');
      await expect(rail).toBeAttached();
      const estimateRun = rail.getByTestId('credit-estimate').locator('bdi');
      await expect(estimateRun).toHaveText(/\d/);
      await expect(estimateRun).not.toHaveText(/[٠-٩۰-۹]/);
      await expect(page.getByLabel('الاسم الداخلي', { exact: false }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // a step with many controls, on a real draft
      await enter(page, wizardUrl('behaviour', draft.id, 'ar'), () => page.getByTestId('wizard-footer'));
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('[data-section="capabilities"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('model-badge').first()).toHaveAttribute('dir', 'ltr');
      await expect(page.locator('output[for="agent-delay"] bdi[dir="ltr"]')).toBeVisible();
      await expect(page.locator('#agent-delay')).toHaveAttribute('dir', 'ltr');
      await expectNoHorizontalOverflow(page);
    });
  }

  for (const size of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    test(`responsive ${size.width}×${size.height}: the wizard is usable (stepper, fields, footer buttons, no horizontal overflow)`, async ({ page }) => {
      await page.setViewportSize(size);
      const rec = await openWizard(page, 'new');
      await expect(page.getByTestId('starting-point').getByRole('radio')).toHaveCount(5, { timeout: 30_000 });
      const steps = page.getByRole('list', { name: "Étapes de l'assistant" });
      await expect(steps.getByRole('listitem')).toHaveCount(5);
      for (const chip of await steps.getByRole('listitem').all()) await expect(chip).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // the footer stays in view with its buttons
      const footer = page.getByTestId('wizard-footer');
      await expect(footer).toBeInViewport();
      for (const id of ['wizard-cancel', 'wizard-save-quit', 'wizard-next']) await expect(footer.getByTestId(id)).toBeInViewport();

      // fields can be filled and the step saved
      const NAME = `Agent mobile ${size.width} ${RUN}`;
      await page.getByTestId('starting-point').locator('[data-name="service-client"]').click();
      await page.getByLabel('NOM INTERNE').fill(NAME);
      await expect(page.getByLabel('NOM INTERNE')).toHaveValue(NAME);
      await expect(page.getByTestId('summary-rail')).toBeAttached();
      await expectNoHorizontalOverflow(page);
      await footer.getByTestId('wizard-next').click();
      await expect(title(page, 'knowledge')).toBeVisible(NAV);
      expect(bodyOf((await expectWrites(rec, 'POST /agents'))[0]!).name).toBe(NAME);
      const id = new URL(page.url()).searchParams.get('draft')!;
      expect((await getAgent(api(page), owner, id)).name).toBe(NAME);
      await expect(page.locator('[data-section="policies"]')).toBeVisible();
      await expect(page.getByTestId('wizard-footer').getByTestId('wizard-back')).toBeInViewport();
      await expect(page.getByTestId('wizard-footer').getByTestId('wizard-next')).toBeInViewport();
      await expectNoHorizontalOverflow(page);

      // the densest step, on the draft just created
      await enter(page, wizardUrl('behaviour', id), () => title(page, 'behaviour'));
      await expect(page.locator('[data-section="order"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('wizard-footer').getByTestId('wizard-next')).toBeInViewport();
      await expectNoHorizontalOverflow(page);
    });
  }
});
