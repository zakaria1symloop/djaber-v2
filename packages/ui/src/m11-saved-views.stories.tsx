// LST-03 saved views — Figma "REF — Deep-link map … + remaining list mechanics", panel « Vues enregistrées (toutes les
// listes) ». One story per state of 12 §… « Saved views »: list (DÉFAUT, shared read-only), loading, empty, error, offline.
import type { Meta, StoryObj } from '@storybook/react';
import { SavedViewsMenu, type SavedViewRow } from './index';

const meta: Meta = { title: 'M11/Saved views' };
export default meta;
type Story = StoryObj;

const labels = {
  trigger: 'Vues',
  title: 'Vues enregistrées',
  saveCurrent: 'Enregistrer la vue courante…',
  empty: 'Aucune vue enregistrée pour cette liste.',
  note: 'Menu ⋯ : renommer · définir par défaut · partager à l’équipe (admin) · supprimer. Une vue partagée est en lecture pour les autres.',
  defaultPill: 'DÉFAUT',
  sharedPill: 'PARTAGÉE',
  rowMenu: (name: string) => `Actions de la vue « ${name} »`,
  loading: 'Chargement des vues',
  error: 'Impossible de charger les vues.',
  retry: 'Réessayer',
};
const views: SavedViewRow[] = [
  { id: '1', name: 'Mes nouvelles IA', isDefault: true, isShared: false, readOnly: false, current: true },
  { id: '2', name: 'À envoyer Sétif', isDefault: false, isShared: true, readOnly: false },
  { id: '3', name: 'Retours à vérifier', isDefault: false, isShared: true, readOnly: true, meta: 'Partagée par Nadia F.' },
];
const actions = (v: SavedViewRow) =>
  v.readOnly
    ? [{ key: 'duplicate', label: 'Dupliquer', onSelect: () => undefined }]
    : [
        { key: 'rename', label: 'Renommer…', onSelect: () => undefined },
        { key: 'default', label: 'Définir par défaut', onSelect: () => undefined, disabledReason: v.isDefault ? 'déjà la vue par défaut' : undefined },
        { key: 'share', label: v.isShared ? 'Ne plus partager' : 'Partager à l’équipe', onSelect: () => undefined },
        { key: 'delete', label: 'Supprimer…', destructive: true, separated: true, onSelect: () => undefined },
      ];
const Frame = ({ children }: { children: React.ReactNode }) => <div className="flex justify-end p-6">{children}</div>;
const base = { onSelect: () => undefined, rowActions: actions, onSaveCurrent: () => undefined, labels };

export const List: Story = { render: () => <Frame><SavedViewsMenu {...base} views={views} /></Frame> };
export const Loading: Story = { render: () => <Frame><SavedViewsMenu {...base} views={undefined} loading /></Frame> };
export const Empty: Story = { render: () => <Frame><SavedViewsMenu {...base} views={[]} /></Frame> };
export const LoadError: Story = { render: () => <Frame><SavedViewsMenu {...base} views={undefined} error onRetry={() => undefined} /></Frame> };
export const Offline: Story = { render: () => <Frame><SavedViewsMenu {...base} views={views} saveDisabledReason="Hors ligne : action indisponible." /></Frame> };
