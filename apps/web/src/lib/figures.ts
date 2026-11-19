// Journey J06v-1 — the screens whose figures are computed from the merchant's writes (Home, the reports, the statistics).
// A write that moves money or stock (sale, payment mode, cash row, purchase payment, order payment / status, stock
// adjustment) and the `cash.updated` event mark them all stale, so an open or cached report never shows the old figure
// (the Paiements report kept the old payment mode for its 30 s stale time).
import type { QueryClient } from '@tanstack/react-query';

/** Query-key roots (after the workspace id) of the figure screens: Home (`dashboard`), Rapports, Statistiques. */
export const FIGURE_KEYS = ['dashboard', 'reports', 'analytics'] as const;

export const invalidateFigures = (qc: QueryClient, ws: string) => Promise.all(FIGURE_KEYS.map((k) => qc.invalidateQueries({ queryKey: [ws, k] })));
