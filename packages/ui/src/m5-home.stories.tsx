// M5 — home pieces: Figma "ANA-01 — Home — default", "ANA-01 — Home — new workspace + banners", "ANA-01b — Home &
// Notifications — states catalogue" (queue card variants incl. Handled, KPI tiles, quick actions, page card badges,
// skeleton).
import type { Meta, StoryObj } from '@storybook/react';
import { Bot, MessageSquareText, Package, Settings2, Share2, Sparkles } from 'lucide-react';
import { buttonClass, HomeEmptyCard, HomeKpiTile, HomePageCard, HomeQueueCard, HomeQueueMore, HomeSection, HomeSkeleton, Pill, pillTone, QuickActionCard } from './index';

const meta: Meta = { title: 'M5/Home' };
export default meta;
type Story = StoryObj;

const Frame = ({ children }: { children: React.ReactNode }) => <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">{children}</div>;

const CARDS: { kind: string; tone: string; label: string; title: string; subtitle: string; age: string }[] = [
  { kind: 'parcel', tone: 'parcel', label: 'COLIS', title: 'Échec de livraison · #CMD-1037 · Lina S.', subtitle: 'Client absent (2/3) — Relancer · Appeler · Retour', age: '1 H' },
  { kind: 'stock', tone: 'stock', label: 'STOCK', title: 'Stock faible · Parfum Oud 50 ml', subtitle: '4 restants (seuil 5) — Ajuster · Commander', age: '3 H' },
  { kind: 'page', tone: 'page', label: 'PAGE', title: 'Reconnexion requise · Amel Outlet (FB)', subtitle: 'Jeton expiré — Reconnecter', age: 'HIER' },
  { kind: 'insight', tone: 'insight', label: 'INSIGHT', title: 'Sujet inconnu ×12 · Vendeur Pro', subtitle: '« vous avez des iPhone ? » — Résoudre', age: '2 MIN' },
  { kind: 'conversation', tone: 'conversation', label: 'CONVERSATION', title: 'À traiter · Sara K.', subtitle: 'demande de remboursement — Assigner · Répondre', age: '11 MIN' },
  { kind: 'callback', tone: 'callback', label: 'RAPPEL', title: 'Rappeler à 16:00 · #CMD-1041 · Yacine M.', subtitle: 'sans réponse 2/3 — Appeler', age: '5 MIN' },
  { kind: 'task', tone: 'job', label: 'TÂCHE', title: 'Import terminé · 118 produits', subtitle: '12 erreurs — Voir le rapport', age: 'IL Y A 2 J' },
];

export const QueueCards: Story = {
  render: () => (
    <Frame>
      <HomeSection label="À traiter" count="7">
        <div className="flex flex-col gap-3">
          {CARDS.map((c) => (
            <HomeQueueCard key={c.kind} kind={c.kind} kindLabel={c.label} tone={pillTone('Home.queue', c.tone)} age={c.age} title={c.title} subtitle={c.subtitle} />
          ))}
          <HomeQueueCard kind="conversation" kindLabel="CONVERSATION" tone={pillTone('Home.queue', 'conversation')} age="1 H" title="Traité · Karim D." subtitle="question sur la taille" handledLabel="fait par Nadia F." />
          <div className="flex flex-wrap gap-2">
            <HomeQueueMore>+ 1 colis en échec</HomeQueueMore>
            <HomeQueueMore>+ 2 alertes stock</HomeQueueMore>
          </div>
        </div>
      </HomeSection>
    </Frame>
  ),
};

export const QueueEmpty: Story = {
  render: () => (
    <Frame>
      <HomeSection label="À traiter" count="0">
        <HomeEmptyCard title="Tout est calme" description="Les conversations à traiter, colis échoués et ruptures de stock apparaîtront ici." />
      </HomeSection>
    </Frame>
  ),
};

export const KpiTiles: Story = {
  render: () => (
    <Frame>
      <HomeSection label="Aperçu">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <HomeKpiTile label="Pages connectées" value="2" />
          <HomeKpiTile label="Produits" value="128" sub="2 stock faible" />
          <HomeKpiTile label="Chiffre d'affaires (30j)" value="0" unit="DA" />
          <HomeKpiTile label="Valeur du stock" value="1,24 M" unit="DA" />
        </div>
      </HomeSection>
    </Frame>
  ),
};

export const QuickActions: Story = {
  render: () => (
    <Frame>
      <HomeSection label="Actions rapides">
        <div className="grid gap-3 sm:grid-cols-3">
          <QuickActionCard icon={<Share2 className="size-5" />} title="Connecter une page" description="Liez votre page Facebook ou Instagram" />
          <QuickActionCard icon={<Package className="size-5" />} title="Ajouter des produits" description="Construisez votre catalogue" />
          <QuickActionCard icon={<Bot className="size-5" />} title="Agents IA" description="Gérez vos assistants" disabledReason="Limite du plan atteinte (PLAN_LIMIT)" />
        </div>
      </HomeSection>
    </Frame>
  ),
};

const actions = (
  <>
    <span className={buttonClass({ size: 'sm', className: 'w-full' })}>
      <MessageSquareText className="size-3.5" />
      Boîte
    </span>
    <span className={buttonClass({ size: 'sm', className: 'w-full' })}>
      <Package className="size-3.5" />
      Stock
    </span>
    <span className={buttonClass({ size: 'sm', className: 'w-full' })}>
      <Settings2 className="size-3.5" />
      Configurer
    </span>
  </>
);

export const PageCards: Story = {
  render: () => (
    <div className="mx-auto flex max-w-[380px] flex-col gap-3 p-6">
      {(
        [
          ['ACTIVE', 'success', true],
          ['EN ATTENTE META', 'warning', false],
          ['RECONNEXION REQUISE', 'danger', false],
          ['EN PAUSE (PLAN)', 'warning', false],
        ] as const
      ).map(([badge, tone, ai]) => (
        <HomePageCard
          key={badge}
          icon={<Share2 className="size-4" />}
          name="Boutique Amel"
          meta="FACEBOOK · CONNECTÉE LE 12 AOÛT"
          badge={
            <Pill tone={tone} className="!rounded-[4px]">
              {badge}
            </Pill>
          }
          ai={ai ? 'IA' : undefined}
          tiles={[
            { key: 'conversations', value: '128', label: 'Conv.', sub: '32 actifs' },
            { key: 'messages', value: '340', label: 'Msg 7j', sub: '210 entr.' },
            { key: 'unread', value: '3', label: 'Non lus', sub: '3 à répondre' },
            { key: 'stock', value: '128', label: 'Stock', sub: 'produits' },
          ]}
          agent={{ icon: <Sparkles className="size-5" />, title: ai ? 'Agent IA prêt' : 'Aucun agent IA', meta: ai ? 'Vendeur Pro' : 'Liez un agent pour répondre sur cette page', action: <span className={buttonClass({ size: 'sm', variant: 'primary' })}>{ai ? 'Régénérer' : 'Lier un agent'}</span> }}
          actions={actions}
        />
      ))}
      <HomeEmptyCard title="Aucune page connectée" description="Connectez Facebook pour que l'agent commence à répondre." action={<span className={buttonClass({ variant: 'primary' })}>Connecter Facebook</span>} />
    </div>
  ),
};

export const Skeleton: Story = { render: () => <HomeSkeleton label="Chargement…" className="p-6" /> };
