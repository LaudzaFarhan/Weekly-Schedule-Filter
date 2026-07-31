'use client';

/**
 * The Average Progress Trend line — one point per evaluation, plotting the
 * `LessonSeries` returned by `src/lib/reportCard.js`.
 *
 * This module and `CompetencyRadarChart.jsx` are the ONLY modules in the app
 * that import `chart.js` (Req 3.8). The page loads both through `next/dynamic`
 * with `ssr: false`, so no charting code is evaluated during server rendering.
 *
 * Only the scales, elements and plugins a LINE chart actually needs are
 * registered — a category x-axis, a linear y-axis, points, the line itself, and
 * `Filler` for the shaded area under the line. `Chart.register(...registerables)`
 * would pull every controller, scale and plugin in the library into the bundle
 * and defeat tree-shaking, so it is not used here. Note the register list is
 * deliberately NOT the radar's: `RadialLinearScale` is absent, and
 * `CategoryScale` / `LinearScale` are present.
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
 * trigger a `chart.update()`. `options` is memoised on the series too, because
 * the tooltip closes over the dates.
 */

import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

/** Fallback canvas size in CSS pixels. Callers override per slot. */
export const DEFAULT_TREND_SIZE = { width: 460, height: 260 };

/**
 * The score scale is fixed 1..5 and never fitted to the data. An auto-fitted
 * axis would stretch a run of 4.0, 4.2, 4.0 across the full plot height and
 * print as a dramatic climb and fall — on a progress chart a parent reads, that
 * is misleading. A fixed axis also keeps two students' trends, and the same
 * student's trend before and after a new evaluation, directly comparable.
 */
const SCALE_MIN = 1;
const SCALE_MAX = 5;
const SCALE_STEP = 1;

/**
 * The trend plots the mean of all five competencies, so it belongs to no single
 * competency and deliberately does NOT take a colour out of `COMPETENCIES` — a
 * radar point and the trend line sharing a colour would imply the line is that
 * one competency. It is the app's success green (the literal behind
 * `var(--success)`, which cannot be read from CSS into a canvas), matching the
 * green line and tinted area in the prototype screenshots.
 */
const SERIES_COLOR = '#10b981';

/**
 * `#rrggbb` → `rgba(r, g, b, alpha)`, so the area tint under the line is derived
 * from the line colour rather than hardcoded a second time beside it.
 *
 * Kept local rather than shared with `CompetencyRadarChart.jsx`: the two charts
 * are separate `next/dynamic` chunks, and importing one from the other would
 * pull the radar into this chart's bundle.
 */
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

const FILL_COLOR = withAlpha(SERIES_COLOR, 0.18);

/** Separators for the flattened series signature — neither appears in a label, value or ISO date. */
const POINT_SEPARATOR = ';';
const FIELD_SEPARATOR = '|';

/**
 * The series flattened to one string, or `null` when it is not plottable
 * (missing, empty, ragged, or carrying a non-finite value).
 *
 * Used both as the memo dependency and as the source the memos read, so a fresh
 * `LessonSeries` object holding the same points does not produce a new `data`
 * identity. `lessonSeries()` guarantees equal-length arrays; the length check
 * here means a caller that hand-builds a series cannot desync labels from dates.
 *
 * @param {{ labels?: string[], values?: number[], dates?: string[] }|null|undefined} series
 * @returns {string|null}
 */
function seriesSignature(series) {
  if (!series || typeof series !== 'object') return null;

  const { labels, values, dates } = series;
  if (!Array.isArray(labels) || !Array.isArray(values) || !Array.isArray(dates)) return null;
  if (labels.length === 0) return null;
  if (labels.length !== values.length || labels.length !== dates.length) return null;

  const parts = [];
  for (let i = 0; i < labels.length; i += 1) {
    const value = Number(values[i]);
    if (!Number.isFinite(value)) return null;
    const date = dates[i] == null ? '' : String(dates[i]);
    parts.push(`${String(labels[i])}${FIELD_SEPARATOR}${value}${FIELD_SEPARATOR}${date}`);
  }
  return parts.join(POINT_SEPARATOR);
}

/** Signature back to `{ labels, values, dates }`. Inverse of {@link seriesSignature}. */
function parseSignature(signature) {
  const labels = [];
  const values = [];
  const dates = [];
  for (const part of signature.split(POINT_SEPARATOR)) {
    const [label, value, date] = part.split(FIELD_SEPARATOR);
    labels.push(label);
    values.push(Number(value));
    dates.push(date);
  }
  return { labels, values, dates };
}

/**
 * @param {Object} props
 * @param {{ labels: string[], values: number[], dates: string[] }|null} props.series
 *   a `LessonSeries` from `lessonSeries()`, or `null`/empty for none
 * @param {{ width?: number, height?: number }} [props.size] explicit canvas size in CSS pixels
 */
export default function ProgressTrendChart({ series, size }) {
  const width = Number(size?.width) > 0 ? Number(size.width) : DEFAULT_TREND_SIZE.width;
  const height = Number(size?.height) > 0 ? Number(size.height) : DEFAULT_TREND_SIZE.height;

  const signature = seriesSignature(series);

  const data = useMemo(() => {
    if (signature === null) return null;
    const { labels, values } = parseSignature(signature);
    return {
      labels,
      datasets: [
        {
          label: 'Average score',
          data: values,
          borderColor: SERIES_COLOR,
          backgroundColor: FILL_COLOR,
          borderWidth: 2,
          // The screenshots show a tinted area beneath the line — that fill is
          // what `Filler` is registered for.
          fill: true,
          tension: 0.3,
          pointBackgroundColor: SERIES_COLOR,
          pointBorderColor: SERIES_COLOR,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
      ],
    };
  }, [signature]);

  const options = useMemo(() => {
    // The tooltip reads the dates through the signature, so a reader can tie the
    // L7 point to the actual lesson day behind it (Req 3.5).
    const dates = signature === null ? [] : parseSignature(signature).dates;

    return {
      // Req 5.10 — print correctness, not performance tuning. See the file header.
      animation: false,
      responsive: false,
      maintainAspectRatio: false,
      devicePixelRatio: 2,
      scales: {
        x: {
          // Lesson ordinals (L1, L2, … or L7, L16) as supplied — never relabelled here.
          grid: { display: false },
          ticks: { color: '#64748b', font: { size: 11 } },
        },
        y: {
          // Fixed 1..5, never fitted to the data. See the note above.
          min: SCALE_MIN,
          max: SCALE_MAX,
          beginAtZero: false,
          ticks: {
            stepSize: SCALE_STEP,
            color: '#64748b',
            font: { size: 11 },
            callback: (value) => Number(value).toFixed(1),
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => (items[0] ? String(items[0].label) : ''),
            label: (item) => {
              const score = `${Number(item.raw).toFixed(1)} / 5.0`;
              const date = dates[item.dataIndex];
              return date ? `${score} — ${date}` : score;
            },
          },
        },
      },
    };
  }, [signature]);

  // Zero evaluations in range: state it, rather than drawing an axis with no
  // plot that reads as a student scoring nothing (Req 3.10). Same message and
  // same treatment as the radar, so the two empty slots match on the page.
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
      <Line data={data} options={options} width={width} height={height} />
    </div>
  );
}
