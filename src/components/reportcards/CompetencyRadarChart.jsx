'use client';

/**
 * The Competency Map radar — five axes, one point per competency, plotting the
 * Competency_Averages returned by `src/lib/reportCard.js`.
 *
 * This module and `ProgressTrendChart.jsx` are the ONLY modules in the app that
 * import `chart.js` (Req 3.8). The page loads both through `next/dynamic` with
 * `ssr: false`, so no charting code is evaluated during server rendering.
 *
 * Only the scales, elements and plugins a radar actually needs are registered.
 * `Chart.register(...registerables)` would pull every controller, scale and
 * plugin in the library into the bundle and defeat tree-shaking, so it is not
 * used here.
 *
 * The chart options are print-correctness requirements, not performance tuning
 * (Req 5.10):
 *   - `responsive: false` — a `responsive: true` chart re-measures and rebuilds
 *     its canvas when the print media query changes, which can blank the canvas
 *     part way through a print job.
 *   - `animation: false` — an animating chart can be caught holding a partially
 *     drawn frame, and a `<canvas>` prints as whatever bitmap it currently holds.
 *   - explicit pixel width and height — with resizing off, the canvas must be
 *     told its size.
 *   - `devicePixelRatio: 2` — the rasterised bitmap stays sharp on paper.
 *
 * `data` and `options` are memoised on the derived values so an unrelated
 * re-render of the page does not hand Chart.js new object identities and
 * trigger a `chart.update()`.
 */

import { useMemo } from 'react';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Radar } from 'react-chartjs-2';

import { COMPETENCIES } from '@/lib/reportCardRubric';

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

/** Fallback canvas size in CSS pixels. Callers override per slot. */
export const DEFAULT_RADAR_SIZE = { width: 320, height: 320 };

/**
 * The competency scale is fixed 1..5 and never fitted to the data. An
 * auto-fitted axis would rescale per student, so two students' radars — or the
 * same student before and after a new evaluation — would not be comparable.
 */
const SCALE_MIN = 1;
const SCALE_MAX = 5;
const SCALE_STEP = 1;

/** Axis labels and per-point colours come from the rubric, never from literals here. */
const LABELS = COMPETENCIES.map((competency) => competency.label);
const POINT_COLORS = COMPETENCIES.map((competency) => competency.color);
const SERIES_COLOR = COMPETENCIES[0].color;

/** `#rrggbb` → `rgba(r, g, b, alpha)`, so the fill tint is derived from the rubric colour. */
function withAlpha(hex, alpha) {
  const value = String(hex).replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return `rgba(59, 130, 246, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const FILL_COLOR = withAlpha(SERIES_COLOR, 0.25);

/**
 * The five averages as a comma-joined signature, or `null` when the set is not
 * plottable. Used both as the memo dependency and as the source the memo reads,
 * so a fresh `averages` object holding the same five numbers does not produce a
 * new `data` identity.
 *
 * @param {Record<string, number>|null|undefined} averages
 * @returns {string|null}
 */
function valueSignature(averages) {
  if (!averages || typeof averages !== 'object') return null;

  const parts = [];
  for (const competency of COMPETENCIES) {
    const value = Number(averages[competency.key]);
    if (!Number.isFinite(value)) return null;
    parts.push(value);
  }
  return parts.join(',');
}

/**
 * @param {Object} props
 * @param {Record<string, number>|null} props.averages Competency_Averages, or `null` for none
 * @param {{ width?: number, height?: number }} [props.size] explicit canvas size in CSS pixels
 */
export default function CompetencyRadarChart({ averages, size }) {
  const width = Number(size?.width) > 0 ? Number(size.width) : DEFAULT_RADAR_SIZE.width;
  const height = Number(size?.height) > 0 ? Number(size.height) : DEFAULT_RADAR_SIZE.height;

  const signature = valueSignature(averages);

  const data = useMemo(() => {
    if (signature === null) return null;
    return {
      labels: LABELS,
      datasets: [
        {
          label: 'Competency average',
          data: signature.split(',').map(Number),
          borderColor: SERIES_COLOR,
          backgroundColor: FILL_COLOR,
          borderWidth: 2,
          fill: true,
          pointBackgroundColor: POINT_COLORS,
          pointBorderColor: POINT_COLORS,
          pointRadius: 4,
          pointHoverRadius: 5,
        },
      ],
    };
  }, [signature]);

  const options = useMemo(
    () => ({
      // Req 5.10 — print correctness, not performance tuning. See the file header.
      animation: false,
      responsive: false,
      maintainAspectRatio: false,
      devicePixelRatio: 2,
      scales: {
        r: {
          min: SCALE_MIN,
          max: SCALE_MAX,
          beginAtZero: false,
          ticks: { stepSize: SCALE_STEP, showLabelBackdrop: false },
          pointLabels: {
            color: (ctx) => POINT_COLORS[ctx.index] || SERIES_COLOR,
            font: { size: 12, weight: '600' },
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${item.label}: ${Number(item.raw).toFixed(1)} / 5.0`,
          },
        },
      },
    }),
    []
  );

  // Zero evaluations in range: state it, rather than drawing an axis with no
  // plot that reads as a student scoring nothing (Req 3.10).
  if (data === null) {
    return (
      <div
        className="report-chart-empty"
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '1rem',
          boxSizing: 'border-box',
          border: '1px dashed #cbd5e1',
          borderRadius: '8px',
          color: '#64748b',
          fontSize: '0.875rem',
        }}
      >
        No evaluations yet
      </div>
    );
  }

  return (
    <div style={{ width, height }}>
      <Radar data={data} options={options} width={width} height={height} />
    </div>
  );
}
