// M8 — Analytics & reports pieces, one story per state: KPI tiles (with / without comparison, empty period, skeleton),
// delta badges, bar chart (single series with top days + previous period, stacked series, empty), funnel, ranked
// panel (rows / empty), donut (slices / empty), wilaya choropleth (data / no data), period presets + custom range
// (empty / start chosen / error), reports hub group (favourite on / off), export job rows (running / ready / failed).
import type { Meta, StoryObj } from '@storybook/react';
import * as React from 'react';
import {
  AnaKpiSkeleton,
  AnaKpiTile,
  BarChart,
  Button,
  ChartPanel,
  DateRangeForm,
  DeltaBadge,
  DonutChart,
  ExportJobRow,
  FunnelBars,
  LegendChip,
  ListCard,
  PeriodPresets,
  RankPanel,
  ReportGroup,
  ReportRow,
  WilayaMap,
} from './index';

const meta: Meta = { title: 'M8/Analytics' };
export default meta;
type Story = StoryObj;

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">{children}</div>
);
const num = (n: number) => new Intl.NumberFormat('fr-FR').format(n).replace(/\s/g, ' ');
const da = (n: number) => `${num(n)} DA`;
const days = Array.from({ length: 30 }, (_, i) => ({
  key: `d${i}`,
  label: `${String((i % 30) + 1).padStart(2, '0')} sept.`,
  values: [Math.round(4000 + Math.abs(Math.sin(i * 1.7)) * 24000)],
}));

export const KpiTiles: Story = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <AnaKpiTile
          value="412 300"
          unit="DA revenus"
          delta={<DeltaBadge value={18} />}
          meta="vs période précédente"
          sub="312 ventes + 94 commandes livrées"
          title="Revenus = ventes comptoir + commandes livrées"
        />
        <AnaKpiTile
          value="186"
          unit="commandes"
          delta={<DeltaBadge value={9} />}
          meta="71 % confirmées"
          sub="dont 142 via IA"
        />
        <AnaKpiTile
          value="68 %"
          unit="taux de livraison"
          delta={<DeltaBadge value={-3} unit="pts" />}
          meta="12 retours"
          sub="sur 139 expédiées"
        />
        <AnaKpiTile
          value="1 204"
          unit="conversations"
          meta="87 % traitées par l'IA"
          sub="48 escaladées"
          onClick={() => undefined}
        />
        <AnaKpiTile value="—" unit="crédits utilisés" meta="aucune donnée" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <AnaKpiSkeleton count={5} />
      </div>
      <div className="flex gap-4">
        <DeltaBadge value={31} />
        <DeltaBadge value={-4} />
        <DeltaBadge value={12} invert />
        <DeltaBadge value={0} />
        <DeltaBadge value={null} newLabel="nouveau" />
      </div>
    </Frame>
  ),
};

export const Charts: Story = {
  render: () => (
    <Frame>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <ChartPanel
          title="Revenus par jour"
          end={
            <>
              <LegendChip tone="money" pressed onToggle={() => undefined}>
                REVENUS
              </LegendChip>
              <LegendChip tone="orders" pressed={false} onToggle={() => undefined}>
                COMMANDES
              </LegendChip>
              <LegendChip tone="muted" dashed>
                PÉRIODE PRÉC. (POINTILLÉS)
              </LegendChip>
            </>
          }
        >
          <BarChart
            label="Revenus par jour"
            buckets={days}
            series={[{ key: 'revenue', label: 'Revenus', tone: 'money' }]}
            previous={days.map((d) => Math.round((d.values[0] ?? 0) * 0.8))}
            previousLabel="Période précédente"
            emphasis="top"
            format={da}
            startLabel="05 sept."
            endLabel="05 oct."
            caption="meilleur jour : 03 oct. · 28 400 DA"
          />
        </ChartPanel>
        <ChartPanel title="Entonnoir conversation → livraison">
          <FunnelBars
            rows={[
              {
                key: 'conv',
                label: 'Conversations',
                value: 1204,
                formatted: '1 204',
                tone: 'inbound',
              },
              {
                key: 'intent',
                label: "Avec intention d'achat",
                value: 402,
                formatted: '402',
                tone: 'inbound',
              },
              {
                key: 'orders',
                label: 'Commandes créées',
                value: 186,
                formatted: '186',
                tone: 'orders',
              },
              {
                key: 'confirmed',
                label: 'Confirmées',
                value: 132,
                formatted: '132',
                tone: 'orders',
              },
              { key: 'delivered', label: 'Livrées', value: 94, formatted: '94', tone: 'money' },
            ]}
          />
        </ChartPanel>
      </div>
      <ChartPanel
        title="Conversations par jour"
        end={
          <>
            <LegendChip tone="inbound">NOUVELLES</LegendChip>
            <LegendChip tone="alert">TRANSFÉRÉES</LegendChip>
          </>
        }
      >
        <BarChart
          label="Conversations par jour"
          buckets={days.map((d, i) => ({ ...d, values: [30 + (i % 7) * 6, 3 + (i % 4)] }))}
          series={[
            { key: 'new', label: 'Nouvelles', tone: 'inbound' },
            { key: 'handoff', label: 'Transférées', tone: 'alert' },
          ]}
          format={num}
          height={140}
        />
      </ChartPanel>
      <ChartPanel title="Inscriptions · activations · churn par jour (groupées, échelle et dates — UX-007 du 22/10)">
        <BarChart
          label="Inscriptions · activations · churn"
          layout="grouped"
          axis
          buckets={days.map((d, i) => ({ ...d, values: [i % 5, i % 7 === 0 ? 1 : 0, i % 11 === 0 ? 1 : 0] }))}
          series={[
            { key: 'signups', label: 'Inscrits', tone: 'inbound' },
            { key: 'activations', label: 'Activés', tone: 'money' },
            { key: 'churned', label: 'Résiliés', tone: 'alert' },
          ]}
          format={num}
        />
      </ChartPanel>
      <ChartPanel title="Crédits par jour et par type">
        <BarChart
          label="Crédits"
          buckets={days.map((d) => ({ ...d, values: [0] }))}
          series={[{ key: 'text', label: 'Texte', tone: 'inbound' }]}
          format={num}
          empty="Aucune donnée sur la période"
          height={120}
        />
      </ChartPanel>
    </Frame>
  ),
};

export const Panels: Story = {
  render: () => (
    <Frame>
      <div className="grid gap-4 lg:grid-cols-3">
        <RankPanel
          title="Top produits (revenus)"
          link={
            <a className="ts-label-micro text-accent-inbound" href="#">
              Tout voir →
            </a>
          }
          rows={[
            {
              key: '1',
              label: 'Parfum Oud 100 ml',
              value: '96 000 DA',
              delta: <DeltaBadge value={31} />,
            },
            {
              key: '2',
              label: 'La Robe satin',
              value: '73 500 DA',
              delta: <DeltaBadge value={12} />,
            },
            {
              key: '3',
              label: 'Sac cuir camel',
              value: '41 000 DA',
              delta: <DeltaBadge value={-4} />,
            },
            {
              key: '4',
              label: 'Tunique brodée',
              value: '22 100 DA',
              delta: <DeltaBadge value={null} newLabel="nouveau" />,
            },
          ]}
        />
        <RankPanel title="Par canal · agent" rows={[]} empty="Aucune donnée sur la période" />
        <ChartPanel title="Motifs d'annulation">
          <DonutChart
            label="Motifs d'annulation"
            format={num}
            center="18"
            slices={[
              { key: 'no_answer', label: 'Injoignable', value: 8, tone: 'orders' },
              { key: 'changed_mind', label: "A changé d'avis", value: 6, tone: 'inbound' },
              { key: 'price', label: 'Prix', value: 3, tone: 'clients' },
              { key: 'other', label: 'Autre', value: 1, tone: 'muted' },
            ]}
          />
        </ChartPanel>
      </div>
      <ChartPanel title="Statuts">
        <DonutChart label="Statuts" format={num} slices={[]} empty="Aucune donnée sur la période" />
      </ChartPanel>
    </Frame>
  ),
};

const names: Record<number, string> = {
  16: 'Alger',
  19: 'Sétif',
  31: 'Oran',
  9: 'Blida',
  23: 'Annaba',
  25: 'Constantine',
  30: 'Ouargla',
  11: 'Tamanrasset',
};
function MapDemo() {
  const [sel, setSel] = React.useState<number | null>(19);
  return (
    <Frame>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel title="Commandes livrées par wilaya">
          <WilayaMap
            values={{ 19: 31, 16: 22, 31: 14, 9: 9, 23: 7, 25: 5, 30: 2, 11: 1 }}
            names={names}
            format={(n) => `${n} cmd`}
            selected={sel}
            onSelect={setSel}
            labels={{
              title: 'Commandes livrées par wilaya',
              low: 'moins',
              high: 'plus',
              noData: 'aucune',
            }}
          />
        </ChartPanel>
        <ChartPanel title="Aucune donnée">
          <WilayaMap
            values={{}}
            names={names}
            format={(n) => `${n}`}
            labels={{
              title: 'Aucune commande sur la période',
              low: 'moins',
              high: 'plus',
              noData: 'aucune',
            }}
          />
        </ChartPanel>
      </div>
    </Frame>
  );
}
export const WilayaChoropleth: Story = { render: () => <MapDemo /> };

const PRESETS = [
  "Aujourd'hui",
  '7 j',
  '30 j',
  'Ce mois',
  'Mois dernier',
  'Trimestre',
  'Année',
  'Personnalisé',
].map((label, i) => ({ value: String(i), label }));
function PickerDemo() {
  const [v, setV] = React.useState('2');
  return (
    <Frame>
      <PeriodPresets label="Période" options={PRESETS} value={v} onChange={setV} />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-card border border-line-edge bg-ink-raised p-3">
          <DateRangeForm
            from=""
            to=""
            onChange={() => undefined}
            onApply={() => undefined}
            hint="Choisissez la date de début et de fin"
            labels={{ from: 'DU', to: 'AU', apply: 'Appliquer', cancel: 'Annuler' }}
            onCancel={() => undefined}
          />
        </div>
        <div className="rounded-card border border-line-edge bg-ink-raised p-3">
          <DateRangeForm
            from="2026-09-05"
            to=""
            onChange={() => undefined}
            onApply={() => undefined}
            hint="Choisissez la date de fin"
            labels={{ from: 'DU', to: 'AU', apply: 'Appliquer' }}
          />
        </div>
        <div className="rounded-card border border-line-edge bg-ink-raised p-3">
          <DateRangeForm
            from="2023-01-01"
            to="2026-10-05"
            onChange={() => undefined}
            onApply={() => undefined}
            error="Période trop longue : 732 jours max. (REPORT_RANGE_TOO_LONG)"
            labels={{ from: 'DU', to: 'AU', apply: 'Appliquer' }}
          />
        </div>
      </div>
    </Frame>
  );
}
export const PeriodPicker: Story = { render: () => <PickerDemo /> };

const link = (children: React.ReactNode, className: string) => (
  <a href="#" className={className}>
    {children}
  </a>
);
export const ReportsHub: Story = {
  render: () => (
    <Frame>
      <div className="grid gap-4 md:grid-cols-3">
        <ReportGroup title="Ventes & revenus" count={3}>
          <ReportRow
            name="Ventes par période"
            favorite
            onToggleFavorite={() => undefined}
            favoriteLabel="Retirer des favoris"
            renderLink={link}
          />
          <ReportRow
            name="Ventes par produit"
            favorite={false}
            onToggleFavorite={() => undefined}
            favoriteLabel="Ajouter aux favoris"
            renderLink={link}
          />
          <ReportRow
            name="Marges & rentabilité"
            description="mode avancé"
            favorite={false}
            favoriteLabel="Ajouter aux favoris"
            renderLink={link}
          />
        </ReportGroup>
      </div>
      <ListCard>
        <ExportJobRow
          title="Mouvements · 01 sept. → 05 oct. · XLSX"
          meta="12 480 lignes"
          state="running"
          pill="EN COURS · 64 %"
          progress={64}
          action={<Button variant="ghost">Annuler</Button>}
        />
        <ExportJobRow
          title="Ventes par produit · septembre · PDF"
          meta="318 lignes"
          state="ready"
          pill="PRÊT · expire dans 6 j"
          action={<Button variant="ghost">Télécharger</Button>}
        />
        <ExportJobRow
          title="Journal de caisse · 30 j · CSV"
          state="failed"
          pill="ÉCHEC · REPORT_EXPORT_FAILED (réessayer)"
          action={<Button variant="ghost">Réessayer</Button>}
        />
        <ExportJobRow
          title="État du stock · aujourd'hui · CSV"
          meta="142 lignes"
          state="cancelled"
          pill="ANNULÉ"
        />
      </ListCard>
    </Frame>
  ),
};
