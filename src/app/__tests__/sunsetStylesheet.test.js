/**
 * Static assertions over the Old Operations sunset section of
 * `src/app/globals.css` (Requirements 8.4, 9.7 and 9.8).
 *
 * WHAT THIS TEST IS: the stylesheet is read as text, the
 * `/* ── Old Operations sunset ── *\/` section is cut out, and the rules inside
 * it are parsed with the same minimal CSS reader `printStylesheet.test.js`
 * uses. Three things are then checked:
 *
 *   - the `prefers-reduced-motion: reduce` branch resolves `animation` to
 *     `none` for the banner, for the two tone classes that add the pulse, and
 *     for the icon, and it changes nothing about position or size (Req 9.7);
 *   - `.ops-sunset-badge` carries no animation and no transition anywhere in
 *     the stylesheet, since it sits inside a control the user clicks (Req 8.4);
 *   - every tone ink, plus the detail ink and the dismiss ink, measures at
 *     least 4.5:1 against the `--panel-bg` value the banner paints on, with
 *     the ratio computed from the WCAG relative-luminance formula rather than
 *     taken from the figures written in the CSS comments (Req 9.8).
 *
 * WHAT THIS TEST CANNOT DO: no browser runs here, so nothing is laid out,
 * matched against a real media query, or painted. A computed `animation-name`
 * of `none` is inferred from the cascade in source order, not read from a
 * `getComputedStyle` call, and "same position and size" is inferred from the
 * absence of layout declarations in the reduced-motion branch. Confirming the
 * rendered result is a browser check, not this file's job.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const GLOBALS_CSS = fileURLToPath(new URL('../globals.css', import.meta.url));

const css = readFileSync(GLOBALS_CSS, 'utf8');

// ── Minimal CSS reader (same approach as printStylesheet.test.js) ────────────

/** Removes /* … *\/ comments so rule text is never matched inside prose. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Splits a block into `{ selectors, declarations }` rules plus nested at-rules
 * such as `@media` and `@keyframes`, keeping each at-rule's raw body so it can
 * be parsed again one level down.
 */
function parseRules(block) {
  const rules = [];
  const atRules = [];
  let prelude = '';

  for (let i = 0; i < block.length; i += 1) {
    const char = block[i];

    if (char === ';' && !prelude.trimStart().startsWith('@')) {
      prelude = '';
      continue;
    }

    if (char !== '{') {
      prelude += char;
      continue;
    }

    let depth = 1;
    let body = '';
    let j = i + 1;
    for (; j < block.length && depth > 0; j += 1) {
      const inner = block[j];
      if (inner === '{') depth += 1;
      else if (inner === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      body += inner;
    }
    i = j;

    const head = prelude.trim();
    prelude = '';
    if (!head) continue;

    if (head.startsWith('@')) atRules.push({ prelude: head, body });
    else rules.push({ selectors: splitSelectorList(head), declarations: body });
  }

  return { rules, atRules };
}

/** Splits a selector list on top-level commas (parentheses are respected). */
function splitSelectorList(head) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const char of head) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Declaration text -> { property: value } with `!important` dropped. */
function parseDeclarations(body) {
  const map = {};
  for (const piece of body.split(';')) {
    const index = piece.indexOf(':');
    if (index === -1) continue;
    const property = piece.slice(0, index).trim().toLowerCase();
    if (!property || property.startsWith('@')) continue;
    map[property] = piece
      .slice(index + 1)
      .replace(/!important/i, '')
      .trim()
      .toLowerCase();
  }
  return map;
}

// ── WCAG contrast, computed rather than trusted ──────────────────────────────

/** `#rgb` or `#rrggbb` -> [r, g, b] in 0…255. Throws on anything else. */
function parseHex(value) {
  const hex = value.trim().replace(/^#/, '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Not a hex colour: ${value}`);
  return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16));
}

/** WCAG 2.x relative luminance of an sRGB colour. */
function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1 through 21. */
function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── The sunset section ──────────────────────────────────────────────────────

const SECTION_MARKER = '/* ── Old Operations sunset ── */';

/**
 * Returns the sunset section: from its own header comment up to the next
 * top-level section header, or to the end of the file when it is last.
 */
function extractSunsetSection(text) {
  const start = text.indexOf(SECTION_MARKER);
  if (start === -1) return null;
  const after = start + SECTION_MARKER.length;
  const next = text.indexOf('\n/* ── ', after);
  return text.slice(after, next === -1 ? text.length : next);
}

const sectionSource = extractSunsetSection(css);
const section = stripComments(sectionSource ?? '');
const { rules: sunsetRules, atRules: sunsetAtRules } = parseRules(section);

const reducedMotion = sunsetAtRules.filter((rule) =>
  /^@media\b[\s\S]*prefers-reduced-motion\s*:\s*reduce/i.test(rule.prelude),
);
const reducedMotionRules = reducedMotion.flatMap((rule) => parseRules(rule.body).rules);

/** Every declaration map, in source order, for rules listing `selector`. */
function declarationsFor(selector, rules) {
  return rules
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => parseDeclarations(rule.declarations));
}

/** The cascaded value of `property` for `selector`: last declaration wins. */
function cascadedValue(selector, property, rules) {
  const values = declarationsFor(selector, rules)
    .map((declarations) => declarations[property])
    .filter((value) => value !== undefined);
  return values.length ? values[values.length - 1] : undefined;
}

const PANEL_BG = (/--panel-bg\s*:\s*([^;]+);/.exec(stripComments(css)) ?? [])[1]?.trim();

const TONES = ['notice', 'warning', 'urgent', 'final', 'past'];

describe('Old Operations sunset stylesheet in globals.css', () => {
  it('exposes exactly one sunset section holding the banner rules', () => {
    expect(sectionSource).not.toBeNull();
    expect(css.split(SECTION_MARKER)).toHaveLength(2);
    expect(declarationsFor('.ops-sunset-banner', sunsetRules).length).toBeGreaterThan(0);
    expect(declarationsFor('.ops-sunset-icon', sunsetRules).length).toBeGreaterThan(0);
    expect(declarationsFor('.ops-sunset-badge', sunsetRules).length).toBeGreaterThan(0);
  });

  describe('Req 9.7 — reduced motion removes the movement and nothing else', () => {
    it('declares exactly one prefers-reduced-motion branch in the section', () => {
      expect(reducedMotion).toHaveLength(1);
      expect(reducedMotionRules.length).toBeGreaterThan(0);
    });

    it('sets animation: none on the banner, both pulsing tones and the icon', () => {
      for (const selector of [
        '.ops-sunset-banner',
        '.ops-sunset-banner-urgent',
        '.ops-sunset-banner-final',
        '.ops-sunset-icon',
      ]) {
        const value = cascadedValue(selector, 'animation', reducedMotionRules);
        expect(value, `${selector} keeps animating under reduced motion`).toBe('none');
      }
    });

    it('places the reduced-motion branch after every rule that animates', () => {
      // Both the entrance rule and the pulse rule match on a single class, so
      // the override only wins because it comes later in source order.
      const branchAt = section.search(/@media[^{]*prefers-reduced-motion/i);
      const animatedAt = [...section.matchAll(/animation\s*:/gi)]
        .map((match) => match.index)
        .filter((index) => index < branchAt);

      expect(branchAt).toBeGreaterThan(-1);
      expect(animatedAt.length).toBeGreaterThan(0);
      expect(Math.max(...animatedAt)).toBeLessThan(branchAt);
    });

    it('changes no layout, size or colour property inside that branch', () => {
      const LAYOUT = [
        'display',
        'position',
        'top',
        'right',
        'bottom',
        'left',
        'width',
        'height',
        'min-width',
        'min-height',
        'max-width',
        'max-height',
        'margin',
        'padding',
        'border',
        'border-width',
        'gap',
        'font-size',
        'line-height',
        'transform',
        'opacity',
        'color',
        'background',
      ];
      const touched = new Set();
      for (const declarations of reducedMotionRules.map((rule) =>
        parseDeclarations(rule.declarations),
      )) {
        for (const property of Object.keys(declarations)) touched.add(property);
      }

      for (const property of LAYOUT) {
        expect(touched, `reduced motion must not change ${property}`).not.toContain(property);
      }
      // Only the movement is taken away.
      for (const property of touched) {
        expect(property).toMatch(/^(animation|transition)(-|$)/);
      }
    });
  });

  describe('Req 8.4 — the switcher badge never moves', () => {
    const { rules: allRules, atRules: allAtRules } = parseRules(stripComments(css));
    const nestedRules = allAtRules.flatMap((rule) => parseRules(rule.body).rules);
    const badgeDeclarations = [
      ...declarationsFor('.ops-sunset-badge', allRules),
      ...declarationsFor('.ops-sunset-badge', nestedRules),
    ];

    it('declares the badge somewhere in the stylesheet', () => {
      expect(badgeDeclarations.length).toBeGreaterThan(0);
    });

    it('declares no animation and no transition on the badge', () => {
      for (const declarations of badgeDeclarations) {
        for (const [property, value] of Object.entries(declarations)) {
          if (!/^(animation|transition)(-|$)/.test(property)) continue;
          // `animation: none` inside the reduced-motion branch is the only
          // acceptable form: it takes movement away rather than adding it.
          expect(value, `.ops-sunset-badge sets ${property}: ${value}`).toBe('none');
        }
      }
    });

    it('names the badge in no @keyframes-driven rule', () => {
      const animating = badgeDeclarations.some((declarations) =>
        Object.entries(declarations).some(
          ([property, value]) =>
            /^animation(-name)?$/.test(property) && value !== 'none' && value !== '',
        ),
      );
      expect(animating).toBe(false);
    });

    it('holds the tab label still by using tabular figures and a fixed line box', () => {
      const base = declarationsFor('.ops-sunset-badge', sunsetRules).at(-1);
      expect(base['font-variant-numeric']).toBe('tabular-nums');
      expect(base['line-height']).toBeDefined();
    });
  });

  describe('Req 9.8 — every ink clears 4.5:1 against the panel surface', () => {
    it('reads the panel surface the banner actually paints on', () => {
      expect(PANEL_BG).toBe('#ffffff');
      expect(cascadedValue('.ops-sunset-banner', 'background', sunsetRules)).toBe(
        'var(--panel-bg)',
      );
      // The tour trigger sits on the same surface, so its label inherits both
      // the tone ink and the contrast figure below.
      expect(cascadedValue('.ops-sunset-cta', 'background', sunsetRules)).toBe('var(--panel-bg)');
      expect(cascadedValue('.ops-sunset-cta', 'color', sunsetRules)).toBe('inherit');
      expect(cascadedValue('.ops-sunset-headline', 'color', sunsetRules)).toBe('inherit');
    });

    it('measures the contrast formula against known values', () => {
      expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
      expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
      // A colour that fails, so the assertions below have teeth.
      expect(contrastRatio('#facc15', '#ffffff')).toBeLessThan(4.5);
    });

    it('gives each of the five tones an ink of at least 4.5:1', () => {
      for (const tone of TONES) {
        const selector = `.ops-sunset-banner-${tone}`;
        const ink = cascadedValue(selector, 'color', sunsetRules);
        expect(ink, `${selector} declares no tone ink`).toBeDefined();
        expect(
          contrastRatio(ink, PANEL_BG),
          `${selector} ink ${ink} on ${PANEL_BG}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('gives the detail text and the dismiss label an ink of at least 4.5:1', () => {
      for (const selector of ['.ops-sunset-detail', '.ops-sunset-dismiss']) {
        const ink = cascadedValue(selector, 'color', sunsetRules);
        expect(ink, `${selector} declares no ink`).toBeDefined();
        expect(
          contrastRatio(ink, PANEL_BG),
          `${selector} ink ${ink} on ${PANEL_BG}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});
