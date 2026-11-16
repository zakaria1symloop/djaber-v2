// Onboarding step 4 — the cards are the published presets of the server (`GET /agents/presets`); the static four of
// the frame are the fallback while the list loads or fails, so the step never blocks.
export const STATIC_PRESETS = ['vendeurPro', 'serviceClient', 'conseillerProduit', 'reponseExpress'] as const;
export type StaticPreset = (typeof STATIC_PRESETS)[number];
/** `vendeurPro` → `vendeur-pro` (seed keys of `AgentPreset`) */
export const presetKeyOf = (s: StaticPreset): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
export const staticOf = (key: string): StaticPreset | null => STATIC_PRESETS.find((s) => norm(s) === norm(key)) ?? null;

export type PresetCard = {
  /** key sent to `POST /agents { presetKey }` */
  key: string;
  /** static twin: its i18n texts (name, tagline, 3 points) are used when the server gives none */
  staticKey: StaticPreset | null;
  name: string | null;
  tagline: string | null;
  recommended: boolean;
  /** true when the card comes from the server list */
  live: boolean;
};

export const presetCards = (server: { key: string; name: string; tagline: string | null; badge: string | null }[] | null | undefined): PresetCard[] => {
  if (!server?.length) return STATIC_PRESETS.map((s, i) => ({ key: presetKeyOf(s), staticKey: s, name: null, tagline: null, recommended: i === 0, live: false }));
  const anyBadge = server.some((p) => p.badge === 'recommended');
  // full-test 16/11 ONBOARDING-01: the four official presets first (in their order), then the others — the first four of the
  // list were platform test presets (« test », « testtest », a person's name)
  const official = STATIC_PRESETS.map((k) => server.find((p) => staticOf(p.key) === k)).filter((p): p is (typeof server)[number] => !!p);
  const ordered = [...official, ...server.filter((p) => !official.includes(p))];
  return ordered.slice(0, 4).map((p, i) => ({ key: p.key, staticKey: staticOf(p.key), name: p.name || null, tagline: p.tagline, recommended: anyBadge ? p.badge === 'recommended' : i === 0, live: true }));
};
