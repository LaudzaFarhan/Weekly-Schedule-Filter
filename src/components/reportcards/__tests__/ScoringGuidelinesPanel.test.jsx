// @vitest-environment jsdom
// This file renders components, so it opts in to a DOM. The suite default is
// `node` (vitest.config.mjs) because building jsdom per file is the single
// largest fixed cost in the run.
/**
 * Unit tests for the rubric reference panel.
 *
 * The point of the component is Req 1.16: the rubric module is the only place
 * descriptor text lives, so these tests check that both variants render all 25
 * descriptors read from `RUBRIC_LEVELS`, that each descriptor is bound to its
 * rating in the markup, and that the component source carries no descriptor
 * string of its own.
 */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import ScoringGuidelinesPanel from '@/components/reportcards/ScoringGuidelinesPanel';
import { COMPETENCIES, RUBRIC_LEVELS } from '@/lib/reportCardRubric';

const RATINGS = [5, 4, 3, 2, 1];
const COMPONENT_PATH = path.join(
  process.cwd(),
  'src',
  'components',
  'reportcards',
  'ScoringGuidelinesPanel.jsx'
);

describe('ScoringGuidelinesPanel', () => {
  it.each(['compact', 'full'])(
    'renders all 25 rubric descriptors and the five competency labels (%s)',
    (variant) => {
      render(<ScoringGuidelinesPanel variant={variant} />);

      for (const competency of COMPETENCIES) {
        expect(screen.getByText(competency.label)).toBeInTheDocument();
        for (const rating of RATINGS) {
          expect(screen.getByText(RUBRIC_LEVELS[competency.key][rating])).toBeInTheDocument();
        }
      }
    }
  );

  it('binds every descriptor to its rating rather than relying on visual order', () => {
    render(<ScoringGuidelinesPanel variant="full" />);

    for (const competency of COMPETENCIES) {
      for (const rating of RATINGS) {
        const descriptor = screen.getByText(RUBRIC_LEVELS[competency.key][rating]);
        expect(descriptor.tagName).toBe('DD');

        // The rating that defines this descriptor is its <dt> sibling, and it
        // announces more than the bare numeral.
        const term = descriptor.previousElementSibling;
        expect(term.tagName).toBe('DT');
        expect(term.textContent).toContain(`Rating ${rating} of 5`);
      }
    }
  });

  it('exposes the full variant with the standardized guidelines heading', () => {
    render(<ScoringGuidelinesPanel variant="full" />);

    expect(
      screen.getByRole('heading', { name: /standardized scoring table guidelines/i })
    ).toBeInTheDocument();
  });

  it('treats an unknown variant as the compact reference', () => {
    render(<ScoringGuidelinesPanel variant="something-else" />);

    expect(screen.getByRole('heading', { name: /^scoring guidelines$/i })).toBeInTheDocument();
    expect(screen.getByText(RUBRIC_LEVELS.concept[5])).toBeInTheDocument();
  });

  it('holds no descriptor text of its own — every word comes from the rubric module', () => {
    const source = fs.readFileSync(COMPONENT_PATH, 'utf8');

    for (const competency of COMPETENCIES) {
      for (const rating of RATINGS) {
        expect(source).not.toContain(RUBRIC_LEVELS[competency.key][rating]);
      }
      expect(source).not.toContain(`'${competency.label}'`);
    }
  });
});
