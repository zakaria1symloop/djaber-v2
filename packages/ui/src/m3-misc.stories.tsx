// M3 — notification centre & queue pieces: Figma "NTF-01 — Notifications — list", "QUEUE — File d'attente — items",
// "DLG — Inbox & queue" (File d'attente — vide), "ANA-01b" (skeleton 5 rows).
import type { Meta, StoryObj } from '@storybook/react';
import { Check } from 'lucide-react';
import { Button, Card, CountHeading, EmptyState, InsightCard, NotificationListSkeleton, NotificationRow, QueueCard, StatusPill } from './index';

const meta: Meta = { title: 'M3/Notifications & queue' };
export default meta;
type Story = StoryObj;

const Frame = ({ children }: { children: React.ReactNode }) => <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">{children}</div>;
const open = (
  <Button variant="ghost" size="sm">
    Ouvrir ›
  </Button>
);

export const NotificationRows: Story = {
  render: () => (
    <Frame>
      <Card className="overflow-hidden">
        <ul aria-label="Notifications">
          <NotificationRow
            unread
            unreadLabel="Non lue"
            pill={
              <StatusPill enumKey="Notification.group" value="orders" className="!rounded-[4px]">
                COMMANDE IA
              </StatusPill>
            }
            title="Nouvelle commande #CMD-1042 · 7 300 DA"
            body="Vendeur Pro a créé une commande pour Amina Belkacem (Boutique Amel)."
            slug="Commande créée par l'IA"
            age="2 MIN"
            action={open}
          />
          <NotificationRow
            unread
            unreadLabel="Non lue"
            pill={
              <StatusPill enumKey="Notification.group" value="queue" className="!rounded-[4px]">
                À TRAITER
              </StatusPill>
            }
            title="Amina B. a répondu dans une conversation en attente"
            body="« راني حابة نبدل القياس » — l'IA est en pause."
            slug="Nouveau message en attente"
            age="2 MIN"
            action={open}
          />
          <NotificationRow
            unread={false}
            unreadLabel="Non lue"
            pill={
              <StatusPill enumKey="Notification.group" value="jobs" className="!rounded-[4px]">
                TÂCHE
              </StatusPill>
            }
            title="Import terminé : 118 produits importés, 3 lignes ignorées"
            body="Téléchargez le rapport d'erreurs pour corriger les 3 lignes."
            slug="Tâche terminée"
            age="IL Y A 2 J"
            action={open}
          />
          <NotificationRow
            unread={false}
            unreadLabel="Non lue"
            pill={
              <StatusPill enumKey="Notification.group" value="members" className="!rounded-[4px]">
                MEMBRES
              </StatusPill>
            }
            title="Sara K. a rejoint l'espace en tant qu'opératrice"
            slug="Nouveau membre"
            age="IL Y A 3 J"
          />
        </ul>
      </Card>
    </Frame>
  ),
};

export const NotificationSkeleton: Story = {
  render: () => (
    <Frame>
      <Card>
        <NotificationListSkeleton label="Chargement…" />
      </Card>
    </Frame>
  ),
};

export const NotificationEmpty: Story = {
  render: () => (
    <Frame>
      <EmptyState icon={<Check className="size-5 text-accent-money" />} title="Vous êtes à jour ✓" description="Les nouvelles notifications apparaîtront ici." />
    </Frame>
  ),
};

const actions = (
  <>
    <Button variant="ghost" size="sm">
      Me l'assigner
    </Button>
    <Button variant="ghost" size="sm">
      Reprendre l'IA
    </Button>
    <Button variant="primary" size="sm">
      Répondre
    </Button>
  </>
);

export const QueueItems: Story = {
  render: () => (
    <Frame>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <CountHeading count={3}>CONVERSATIONS À TRAITER</CountHeading>
          <QueueCard label="TRANSFERT · REMBOURSEMENT" age="2 MIN" title="Amina B. · Boutique Amel" preview="راني حابة نبدل القياس، حابتي صغيرة" meta="Assignée : non assignée" actions={actions} />
          <QueueCard label="DEMANDE HUMAIN" age="11 MIN" title="Yacine M. · Boutique Amel" preview="wach kayen promo 3la had l'article ? nahdar m3a wahed" meta="Assignée : Sara K." actions={actions} />
          <QueueCard label="CRÉDITS ÉPUISÉS" age="1 H" title="Karim D. · Amel Cosmétiques" preview="Je veux commander 2 Parfum Oud 50 ml" meta="Assignée : non assignée" actions={actions} />
        </section>
        <section className="flex flex-col gap-3">
          <CountHeading count={3}>PROBLÈMES SIGNALÉS</CountHeading>
          {(
            [
              ['unclear', 'INCOMPRÉHENSION', 'Lina S. · Vendeur Pro', '« kyn 3ndkm dik li fiha … »', "L'agent a demandé de reformuler (il continue de répondre)"],
              ['unknown_topic', 'SUJET INCONNU', 'Nadia F. · Vendeur Pro', '« Vous faites aussi les retouches ? »', 'Sujet inconnu — conversation transférée'],
              ['error', 'ERREUR IA', 'Walid H. · Service Client', '« — »', 'Fournisseur IA indisponible (3 échecs) — modèle de secours utilisé ensuite'],
            ] as const
          ).map(([type, label, who, quote, detail]) => (
            <InsightCard
              key={type}
              pill={
                <StatusPill enumKey="AgentInsight.type" value={type} className="!rounded-[4px]">
                  {label}
                </StatusPill>
              }
              who={who}
              age="5 H"
              quote={quote}
              detail={detail}
              actions={<Button size="sm">Ouvrir</Button>}
            />
          ))}
        </section>
      </div>
    </Frame>
  ),
};

export const QueueEmpty: Story = {
  render: () => (
    <Frame>
      <EmptyState icon={<Check className="size-6 text-accent-money" />} title="Tout est calme" description="Aucune conversation n'attend un humain. Les insights apparaissent ici." />
    </Frame>
  ),
};

export const SafetyPills: Story = {
  render: () => (
    <Frame>
      <div className="flex flex-wrap gap-2">
        <StatusPill enumKey="CustomerBlock.source" value="manual" className="!rounded-[4px]">
          MANUEL
        </StatusPill>
        <StatusPill enumKey="CustomerBlock.source" value="auto_rule" className="!rounded-[4px]">
          AUTO
        </StatusPill>
        <StatusPill enumKey="CustomerBlock.source" value="platform" className="!rounded-[4px]">
          PLATEFORME
        </StatusPill>
        <StatusPill enumKey="DataDeletion.status" value="pending">
          EN COURS
        </StatusPill>
        <StatusPill enumKey="DataDeletion.status" value="done">
          TERMINÉ
        </StatusPill>
        <StatusPill enumKey="DataDeletion.status" value="not_found">
          INTROUVABLE
        </StatusPill>
      </div>
    </Frame>
  ),
};
