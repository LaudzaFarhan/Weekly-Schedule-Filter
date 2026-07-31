// @vitest-environment jsdom
// This file renders components, so it opts in to a DOM. The suite default is
// `node` (vitest.config.mjs) because building jsdom per file is the single
// largest fixed cost in the run.
/**
 * Unit tests for the two chart components.
 *
 * Two behaviours are pinned here:
 *   - Req 3.10 — with zero evaluations in range, each chart renders a STATED
 *     message rather than an axis with no plotted data. The assertions check for
 *     the words on screen, not merely for the absence of a canvas: an empty box
 *     would also pass a "no chart rendered" check while still reading as a
 *     student scoring nothing.
 *   - Req 5.10 — the options handed to Chart.js carry `animation: false`,
 *     `responsive: false` and `devicePixelRatio: 2`, together with an explicit
 *     pixel width and height, so a media change to print cannot rebuild a
 *     canvas mid-job.
 *
 * `chart.js` and `react-chartjs-2` are both mocked. jsdom implements no canvas,
 * so the real library cannot construct a chart here; the stub also captures the
 * props handed to `<Radar>` / `<Line>`, which is the only way to read the
 * options a component passed.
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { COMPETENCIES } from '@/lib/reportCardRubric';

/** Every `<Radar>` / `<Line>` render, in order: `{ kind, props }`. */
const chartRenders = vi.hoisted(() => []);

vi.mock('chart.js', () => ({
  // The components call `ChartJS.register(...)` at module scope, so `register`
  // has to exist. What they register is task 11.1/11.2's concern, not this file's.
  Chart: { register: vi.fn() },
  RadialLinearScale: { id: 'radialLinear' },
  CategoryScale: { id: 'category' },
  LinearScale: { id: 'linear' },
  PointElement: { id: 'point' },
  LineElement: { id: 'line' },
  Filler: { id: 'filler' },
  Tooltip: { id: 'tooltip' },
  Legend: { id: 'legend' },
}));

vi.mock('react-chartjs-2', async () => {
  const { createElement } = await import('react');

  const stub = (kind) => {
    const Stub = (props) => {
      chartRenders.push({ kind, props });
      return createElement('div', { 'data-testid': `chart-${kind}` });
    };
    Stub.displayName = `${kind}Stub`;
    return Stub;
  };

  return { Radar: stub('radar'), Line: stub('line') };
});

// Imported after the mock declarations; `vi.mock` is hoisted above all of them.
const { default: CompetencyRadarChart } = await import(
  '@/components/reportcards/CompetencyRadarChart'
);
const { default: ProgressTrendChart } = await import(
  '@/components/reportcards/ProgressTrendChart'
);

/* ----------------------------------------------------------------- fixtures */

const EMPTY_MESSAGE = /no evaluations yet/i;

/** Five plottable Competency_Averages, keyed off the rubric rather than literals. */
function averagesFixture() {
  const averages = {};
  COMPETENCIES.forEach((competency, index) => {
    averages[competency.key] = 3 + (index % 3) * 0.5;
  });
  return averages;
}

/** A plottable three-point LessonSeries. */
const seriesFixture = () => ({
  labels: ['L1', 'L2', 'L3'],
  values: [3.4, 4.0, 4.6],
  dates: ['2026-01-05', '2026-01-12', '2026-01-19'],
});

const lastRender = (kind) => chartRenders.filter((entry) => entry.kind === kind).at(-1);

beforeEach(() => {
  chartRenders.length = 0;
});

/* ------------------------------------------------------------- empty states */

describe('chart empty states (Req 3.10)', () => {
  const cases = [
    ['radar, averages null', <CompetencyRadarChart averages={null} />],
    ['radar, averages undefined', <CompetencyRadarChart />],
    [
      'radar, one competency missing',
      <CompetencyRadarChart averages={{ ...averagesFixture(), attitude: undefined }} />,
    ],
    ['trend, series null', <ProgressTrendChart series={null} />],
    [
      'trend, series empty',
      <ProgressTrendChart series={{ labels: [], values: [], dates: [] }} />,
    ],
  ];

  it.each(cases)('states the empty message instead of plotting (%s)', (_name, element) => {
    const { container } = render(element);

    // Stated, not silent: the words are on screen and the node is not a blank box.
    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(container.textContent.trim()).not.toBe('');

    // And no chart was handed any data to plot.
    expect(chartRenders).toHaveLength(0);
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('gives the empty panel the same size the chart would have occupied', () => {
    const { container } = render(
      <CompetencyRadarChart averages={null} size={{ width: 300, height: 240 }} />
    );

    const panel = container.querySelector('.report-chart-empty');
    expect(panel).not.toBeNull();
    expect(panel.style.width).toBe('300px');
    expect(panel.style.height).toBe('240px');
  });

  it('uses one wording for both charts, so the two empty slots match', () => {
    const radar = render(<CompetencyRadarChart averages={null} />);
    const radarText = screen.getByText(EMPTY_MESSAGE).textContent.trim();
    radar.unmount();

    render(<ProgressTrendChart series={null} />);
    expect(screen.getByText(EMPTY_MESSAGE).textContent.trim()).toBe(radarText);
  });
});

/* ------------------------------------------------------------- print options */

describe('chart print options (Req 5.10)', () => {
  it('passes animation off, resizing off and devicePixelRatio 2 to the radar', () => {
    render(<CompetencyRadarChart averages={averagesFixture()} size={{ width: 320, height: 320 }} />);

    const { props } = lastRender('radar');
    expect(props.options.animation).toBe(false);
    expect(props.options.responsive).toBe(false);
    expect(props.options.devicePixelRatio).toBe(2);

    // With resizing off the canvas has to be told its size explicitly.
    expect(props.width).toBe(320);
    expect(props.height).toBe(320);
  });

  it('passes animation off, resizing off and devicePixelRatio 2 to the trend', () => {
    render(<ProgressTrendChart series={seriesFixture()} size={{ width: 460, height: 260 }} />);

    const { props } = lastRender('line');
    expect(props.options.animation).toBe(false);
    expect(props.options.responsive).toBe(false);
    expect(props.options.devicePixelRatio).toBe(2);

    expect(props.width).toBe(460);
    expect(props.height).toBe(260);
  });

  it('keeps those options with the default size, when no size is supplied', () => {
    render(<CompetencyRadarChart averages={averagesFixture()} />);
    render(<ProgressTrendChart series={seriesFixture()} />);

    for (const kind of ['radar', 'line']) {
      const { props } = lastRender(kind);
      expect(props.options).toMatchObject({
        animation: false,
        responsive: false,
        devicePixelRatio: 2,
      });
      expect(props.width).toBeGreaterThan(0);
      expect(props.height).toBeGreaterThan(0);
    }
  });

  it('plots the five averages and the supplied lesson labels', () => {
    const averages = averagesFixture();
    render(<CompetencyRadarChart averages={averages} />);
    expect(lastRender('radar').props.data.datasets[0].data).toEqual(
      COMPETENCIES.map((competency) => averages[competency.key])
    );

    const series = seriesFixture();
    render(<ProgressTrendChart series={series} />);
    expect(lastRender('line').props.data.labels).toEqual(series.labels);
    expect(lastRender('line').props.data.datasets[0].data).toEqual(series.values);
  });
});
