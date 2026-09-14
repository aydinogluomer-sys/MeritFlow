// Phase P0 — shared visualization primitives (plan §19). Presentational, accessible, no data fetching.
// Phase P4 (8-B1) adds the Recharts-backed charts (Sparkline/TrendChart/DistributionChart/Waterfall)
// + the §10.16 ChartFrame; each chart pairs its SVG with an accessible <table> (ChartDataTable).
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

// P4 (8-B1) chart primitives.
export { Sparkline, type SparklineProps } from './charts/sparkline';
export { TrendChart, type TrendChartProps, type TrendPoint } from './charts/trend-chart';
export { DistributionChart, type DistributionChartProps, type DistributionBin } from './charts/distribution-chart';
export { WaterfallChart, type WaterfallChartProps, type WaterfallStep } from './charts/waterfall-chart';
export { ChartFrame, type ChartFrameProps } from './charts/chart-frame';
export { ChartDataTable, type ChartDataTableProps, type DataTableColumn } from './charts/data-table';
