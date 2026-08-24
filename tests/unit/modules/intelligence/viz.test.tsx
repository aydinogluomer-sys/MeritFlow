import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DeltaBadge,
  MetricCard,
  DriverList,
  EvidenceDrawer,
  InsightCard,
} from '@/components/intelligence';

// Presentational + accessibility checks (plan §19): direction/severity conveyed by label+glyph (not
// color), table alternative for drivers, native disclosure for evidence, action affordances present.

describe('DeltaBadge', () => {
  it('labels an increase with direction, not color alone', () => {
    render(<DeltaBadge value={5} unit="%" />);
    expect(screen.getByLabelText('5% arttı')).toBeInTheDocument();
    expect(screen.getByText('+5%')).toBeInTheDocument();
  });
  it('labels a decrease', () => {
    render(<DeltaBadge value={-3} unit="%" />);
    expect(screen.getByLabelText('3% azaldı')).toBeInTheDocument();
  });
  it('labels no change', () => {
    render(<DeltaBadge value={0} unit="%" />);
    expect(screen.getByLabelText('0% değişmedi')).toBeInTheDocument();
  });
});

describe('MetricCard', () => {
  it('associates the value with its label and shows a text status', () => {
    render(<MetricCard label="Ödeme" value="100" unit="TL" status="critical" />);
    expect(screen.getByLabelText('Ödeme: 100TL')).toBeInTheDocument();
    expect(screen.getByText('Kritik')).toBeInTheDocument();
  });
});

describe('DriverList', () => {
  it('renders an accessible table with headers and a signed impact', () => {
    render(
      <DriverList
        drivers={[{ code: 'VOLUME_WEIGHT_HIGH', impact: -18, value: 0.54, threshold: 0.4 }]}
      />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Sürücü')).toBeInTheDocument();
    expect(screen.getByText('VOLUME_WEIGHT_HIGH')).toBeInTheDocument();
    expect(screen.getByText('−18')).toBeInTheDocument();
  });
  it('renders an empty state without a table', () => {
    render(<DriverList drivers={[]} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Gösterilecek sürücü yok.')).toBeInTheDocument();
  });
});

describe('EvidenceDrawer', () => {
  it('is a native disclosure listing evidence refs', () => {
    render(<EvidenceDrawer evidence={[{ sourceType: 'metric', sourceId: 'm1' }]} />);
    expect(screen.getByText('Kanıt (1)')).toBeInTheDocument();
    expect(screen.getByText('m1')).toBeInTheDocument();
  });
});

describe('InsightCard', () => {
  it('surfaces headline, severity text, evidence and at least one action', () => {
    render(
      <InsightCard
        headline="Ödeme yoğunlaşması arttı"
        severity="critical"
        facts={{ top1: 0.32 }}
        evidence={[{ sourceType: 'metric', sourceId: 'payout_concentration' }]}
        actions={[{ code: 'inspect', label: 'İncele' }]}
      />,
    );
    expect(screen.getByText('Ödeme yoğunlaşması arttı')).toBeInTheDocument();
    expect(screen.getByText('Kritik')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'İncele' })).toBeInTheDocument();
  });
});
