// Phase P0 — shared visualization primitives (plan §19). Presentational, accessible, no data
// fetching. Recharts-backed charts (TrendChart, DistributionChart, WaterfallChart, ScatterPlot,
// Heatmap, ForecastBand) are DEFERRED to P4 when they are consumed — no charting dependency in P0.
export { DeltaBadge, type DeltaBadgeProps } from './DeltaBadge';
export { MetricCard, type MetricCardProps, type MetricStatus } from './MetricCard';
export { DriverList, type DriverListProps, type Driver } from './DriverList';
export { EvidenceDrawer, type EvidenceDrawerProps, type EvidenceItem } from './EvidenceDrawer';
export {
  InsightCard,
  type InsightCardProps,
  type InsightCardAction,
  type InsightSeverity,
} from './InsightCard';
