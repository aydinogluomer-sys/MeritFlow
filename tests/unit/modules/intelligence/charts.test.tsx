import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sparkline, TrendChart, DistributionChart, WaterfallChart, ChartFrame } from '@/components/intelligence';

// Phase P4 (8-B1) — §19 accessibility of the Recharts primitives: every chart pairs its (aria-hidden)
// SVG with an accessible data TABLE (source of truth), direction is conveyed by TEXT/glyph not color,
// and ChartFrame carries the §10.16 question + definition. Recharts ResponsiveContainer needs a
// ResizeObserver (absent in jsdom) — stub it so the components render.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

describe('TrendChart', () => {
  it('renders an accessible data-table alternative with the plotted rows (§19)', () => {
    render(
      <TrendChart
        data={[
          { label: '2026-01', value: 1000 },
          { label: '2026-02', value: 1500 },
        ]}
        valueLabel="Ödeme"
        unit="₺"
        caption="Dönem bazında ödeme"
      />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('2026-02')).toBeInTheDocument();
    expect(screen.getByText('1.500')).toBeInTheDocument(); // tr-TR thousands separator
  });
  it('shows an empty state (no table) when there is no data', () => {
    render(<TrendChart data={[]} valueLabel="Ödeme" caption="x" />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Gösterilecek veri yok.')).toBeInTheDocument();
  });
});

describe('DistributionChart', () => {
  it('renders an accessible bin table', () => {
    render(
      <DistributionChart
        data={[
          { label: '0–100', count: 3 },
          { label: '100–200', count: 1 },
        ]}
        countLabel="Çalışan"
        caption="Ödeme dağılımı"
      />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('0–100')).toBeInTheDocument();
  });
});

describe('WaterfallChart', () => {
  it('table encodes direction by glyph (not color) + running total', () => {
    render(
      <WaterfallChart
        data={[
          { label: 'Havuz', delta: 1000 },
          { label: 'Tahakkuk', delta: -400 },
        ]}
        valueLabel="Kalan"
        unit="₺"
        caption="Akış"
      />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText(/▲/)).toBeInTheDocument(); // positive step direction glyph
    expect(screen.getByText(/▼/)).toBeInTheDocument(); // negative step direction glyph
  });
});

describe('Sparkline', () => {
  it('carries a TEXT trend label (not color alone)', () => {
    render(<Sparkline data={[1, 2, 3]} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Eğilim');
  });
  it('renders nothing for a single point', () => {
    const { container } = render(<Sparkline data={[1]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ChartFrame', () => {
  it('frames a chart with its §10.16 question + metric definition + filter chips', () => {
    render(
      <ChartFrame question="Ödemeler nasıl değişti?" metricDefinition="payout_total, dönem bazında" filters={['Pencere: son 6 dönem']}>
        <div>grafik</div>
      </ChartFrame>,
    );
    expect(screen.getByText('Ödemeler nasıl değişti?')).toBeInTheDocument();
    expect(screen.getByText('payout_total, dönem bazında')).toBeInTheDocument();
    expect(screen.getByText('Pencere: son 6 dönem')).toBeInTheDocument();
  });
});
