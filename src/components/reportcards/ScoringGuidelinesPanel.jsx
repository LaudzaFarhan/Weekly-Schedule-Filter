import React from 'react';

import { COMPETENCIES, RUBRIC_LEVELS } from '../../lib/reportCardRubric';

/**
 * The rubric reference: five competencies × five ratings, read straight out of
 * `src/lib/reportCardRubric.js`.
 *
 * One component serves both places the rubric is shown (Req 1.16):
 *
 *   - `variant="compact"` — the reference that sits beside the evaluation form.
 *   - `variant="full"`    — the standalone Standardized Scoring Table Guidelines
 *                           view, a multi-column card grid.
 *
 * They differ only in chrome and density; both walk the same `COMPETENCIES` and
 * `RUBRIC_LEVELS` exports, so the form's live descriptor line, this panel and the
 * full guidelines page cannot drift apart. There is deliberately NO descriptor
 * string in this file — every word of rubric wording comes from the rubric
 * module, and the competency labels and colours come from `COMPETENCIES` so the
 * coloured headings here match the star rows in the form.
 *
 * Presentational only: no data fetching, no state, no hooks.
 */

/** Ratings are listed best-first, 5 down to 1, as in the prototype screenshots. */
const RATINGS = [5, 4, 3, 2, 1];

/**
 * Off-screen but still announced. `globals.css` has a single writer in this
 * feature, so the helper class lives here as an inline style instead.
 */
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const VARIANTS = {
  compact: {
    heading: 'Scoring Guidelines',
    subtitle: 'Rating scale for every competency, 5 down to 1.',
    minColumn: '100%',
    gap: '0.6rem',
    cardPadding: '0.6rem 0.7rem',
    labelSize: '0.78rem',
    ratingSize: '0.72rem',
    descriptorSize: '0.72rem',
  },
  full: {
    heading: 'Standardized Scoring Table Guidelines',
    subtitle:
      'The wording used for every rating in every competency. Instructors score against these levels.',
    minColumn: '260px',
    gap: '1rem',
    cardPadding: '1rem 1.1rem',
    labelSize: '0.95rem',
    ratingSize: '0.8rem',
    descriptorSize: '0.8rem',
  },
};

/**
 * @param {Object} props
 * @param {'compact'|'full'} [props.variant='compact'] density and chrome; anything
 *   other than `'full'` renders the compact form
 * @param {Array<{ key: string, label: string, color: string, descriptors?: Record<string|number, string> }>} [props.competencies]
 * @param {Record<string, Record<string|number, string>>} [props.rubricLevels]
 * @param {string} [props.title] overrides the heading text
 * @param {string} [props.subtitle] overrides the sub-heading; `''` hides it
 * @param {string} [props.idPrefix] id stem for the `aria-labelledby` wiring
 */
export default function ScoringGuidelinesPanel({
  variant = 'compact',
  competencies = COMPETENCIES,
  rubricLevels = RUBRIC_LEVELS,
  title,
  subtitle,
  idPrefix,
}) {
  const isFull = variant === 'full';
  const style = isFull ? VARIANTS.full : VARIANTS.compact;

  const headingText = title ?? style.heading;
  const subtitleText = subtitle === undefined ? style.subtitle : subtitle;
  const prefix = idPrefix || `scoring-guidelines-${isFull ? 'full' : 'compact'}`;
  const headingId = `${prefix}-heading`;

  const list = Array.isArray(competencies) && competencies.length > 0 ? competencies : COMPETENCIES;

  const grid = (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${style.minColumn}, 1fr))`,
        gap: style.gap,
      }}
    >
      {list.map((competency) => {
        const itemColor = competency.color || '#3b82f6';
        return (
          <article
            key={competency.key || competency.id || competency.label}
            style={{
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              background: 'var(--bg-color)',
              padding: style.cardPadding,
              borderTop: `3px solid ${itemColor}`,
            }}
          >
            {isFull ? (
              <h3
                style={{
                  margin: '0 0 0.6rem',
                  fontSize: style.labelSize,
                  fontWeight: 700,
                  color: itemColor,
                }}
              >
                {competency.label}
              </h3>
            ) : (
              <h4
                style={{
                  margin: '0 0 0.4rem',
                  fontSize: style.labelSize,
                  fontWeight: 700,
                  color: itemColor,
                }}
              >
                {competency.label}
              </h4>
            )}

            {/*
              A description list, so each descriptor is bound to its rating in the
              markup rather than by sitting next to it on screen. The numeral is
              never the only carrier of the meaning: every term also announces
              "Rating N of 5".
            */}
            <dl style={{ margin: 0, display: 'grid', gap: '0.35rem' }}>
              {RATINGS.map((rating) => {
                const text =
                  competency.descriptors?.[rating] ??
                  competency.descriptors?.[String(rating)] ??
                  rubricLevels?.[competency.key]?.[rating] ??
                  rubricLevels?.[competency.key]?.[String(rating)] ??
                  RUBRIC_LEVELS[competency.key]?.[rating] ??
                  '—';

                return (
                  <div
                    key={rating}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}
                  >
                    <dt
                      style={{
                        flexShrink: 0,
                        minWidth: '1.35rem',
                        textAlign: 'center',
                        fontSize: style.ratingSize,
                        fontWeight: 700,
                        lineHeight: 1.5,
                        borderRadius: '6px',
                        color: itemColor,
                        border: `1px solid ${itemColor}`,
                      }}
                    >
                      <span style={VISUALLY_HIDDEN}>{`Rating ${rating} of 5`}</span>
                      <span aria-hidden="true">{rating}</span>
                    </dt>
                    <dd
                      style={{
                        margin: 0,
                        fontSize: style.descriptorSize,
                        lineHeight: 1.5,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {text}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </article>
        );
      })}
    </div>
  );

  if (isFull) {
    return (
      <section className="panel" aria-labelledby={headingId}>
        <div className="panel-header" style={{ display: 'block' }}>
          <h2 id={headingId} style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            {headingText}
          </h2>
          {subtitleText ? (
            <p
              style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                margin: '0.2rem 0 0',
              }}
            >
              {subtitleText}
            </p>
          ) : null}
        </div>
        <div className="panel-body" style={{ padding: '1.25rem 1.5rem' }}>
          {grid}
        </div>
      </section>
    );
  }

  return (
    <aside
      aria-labelledby={headingId}
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        padding: '0.9rem 1rem',
        background: 'var(--panel-bg, #ffffff)',
      }}
    >
      <h3
        id={headingId}
        style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}
      >
        {headingText}
      </h3>
      {subtitleText ? (
        <p
          style={{
            fontSize: '0.72rem',
            color: 'var(--text-secondary)',
            margin: '0.2rem 0 0.75rem',
          }}
        >
          {subtitleText}
        </p>
      ) : (
        <div style={{ height: '0.6rem' }} />
      )}
      {grid}
    </aside>
  );
}
