/**
 * Static assertions over the print stylesheet in `src/app/globals.css`
 * (Requirements 5.7 and 5.9).
 *
 * WHAT THIS TEST IS: the print rules are read as text, the `@media print`
 * block is parsed out, and the rules inside it are checked against the real
 * ancestor chain of `#report-card-print`. The chain is not guessed — it comes
 * from `AppShell.jsx` (`.app-layout` > `main.dashboard-container` >
 * `.dashboard-views`) and `NewStudentReportCardsPage.jsx`
 * (`section.dashboard-view.active` > an unclassed wrapper > the document).
 *
 * WHY IT MATTERS: a <canvas> prints as the bitmap it holds. If any ANCESTOR of
 * the report — or of a chart canvas inside it — is `display: none` while the
 * print job is laid out, the canvas is never sized and the sheet prints blank.
 * So chrome must be hidden by setting `display: none` on the chrome element
 * itself, never on a wrapper the report lives inside (Req 5.7).
 *
 * WHAT THIS TEST CANNOT DO: a static check cannot verify that a canvas is
 * actually rasterised into a print job. No browser runs here, no layout is
 * performed, and no paint happens. Confirming the printed output is manual
 * task 19.1's job, in Chrome, Edge and Firefox. This test covers the rules,
 * not the rendering.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const GLOBALS_CSS = fileURLToPath(new URL('../globals.css', import.meta.url));
const APP_SHELL = fileURLToPath(new URL('../../components/layout/AppShell.jsx', import.meta.url));
const REPORT_PAGE = fileURLToPath(
  new URL('../../views/NewStudentReportCardsPage.jsx', import.meta.url),
);

const css = readFileSync(GLOBALS_CSS, 'utf8');

// ── Minimal CSS reader ───────────────────────────────────────────────────────

/** Removes /* … *\/ comments so rule text is never matched inside prose. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Returns the inner text of the first `@media print { … }` block, counting
 * braces so the nested `@page` and rule blocks do not end it early.
 */
function extractMediaPrintBlock(text) {
  const match = /@media\s+print\s*\{/i.exec(text);
  if (!match) return null;

  let depth = 1;
  const start = match.index + match[0].length;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i);
    }
  }
  throw new Error('Unterminated @media print block in globals.css');
}

/**
 * Splits a block into `{ selectors, declarations }` rules plus nested at-rules
 * such as `@page`. Only one nesting level is needed here.
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

    // Consume the balanced block that follows.
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

/**
 * The subject of a selector: the rightmost compound, i.e. the element the rule
 * actually styles. `.dashboard-container > header` has the subject `header`.
 */
function selectorSubject(selector) {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) {
      cut = i + 1;
    }
  }
  return selector.slice(cut).trim();
}

/** Breaks a compound selector into its simple parts, dropping `:pseudo(…)`. */
function compoundParts(compound) {
  const withoutFunctional = compound.replace(/:{1,2}[\w-]+\([^)]*\)/g, '');
  const parts = [];
  const pattern = /([#.]?[\w-]+|\*|\[[^\]]*\]|:{1,2}[\w-]+)/g;
  let match = pattern.exec(withoutFunctional);
  while (match) {
    parts.push(match[1]);
    match = pattern.exec(withoutFunctional);
  }
  return parts;
}

// ── The real ancestor chain of #report-card-print ────────────────────────────
// Derived from AppShell.jsx and NewStudentReportCardsPage.jsx. `classes` lists
// every class the element can carry in any state.

const REPORT_ANCESTORS = [
  { name: '<html>', tag: 'html', classes: [] },
  { name: '<body>', tag: 'body', classes: [] },
  { name: '.app-layout', tag: 'div', classes: ['app-layout', 'sidebar-collapsed'] },
  { name: 'main.dashboard-container', tag: 'main', classes: ['dashboard-container'] },
  { name: '.dashboard-views', tag: 'div', classes: ['dashboard-views', 'new-ops-anim'] },
  { name: 'section.dashboard-view', tag: 'section', classes: ['dashboard-view', 'active'] },
  // The preview column and the off-screen print mount. Both are plain <div>s
  // that deliberately carry no class at all (see Req 5.6 in the page).
  { name: 'unclassed report wrapper <div>', tag: 'div', classes: [] },
];

// Ancestors of a chart canvas add the report's own wrappers (ReportCardDocument).
const CANVAS_ANCESTORS = [
  ...REPORT_ANCESTORS,
  { name: '#report-card-print', tag: 'div', id: 'report-card-print', classes: [] },
  { name: 'section.report-section', tag: 'section', classes: ['report-section'] },
  { name: '.report-chart-slot', tag: 'div', classes: ['report-chart-slot'] },
];

/** True when a selector subject could match the modelled ancestor element. */
function subjectMatchesAncestor(subject, node) {
  const parts = compoundParts(subject);
  if (parts.length === 0) return false;

  return parts.every((part) => {
    if (part === '*') return true;
    if (part.startsWith('::')) return false; // pseudo-element, never an ancestor
    if (part.startsWith(':')) return true; // state pseudo-class: assume it can hold
    if (part.startsWith('[')) return true; // attribute selector: assume it can hold
    if (part.startsWith('#')) return node.id === part.slice(1);
    if (part.startsWith('.')) return node.classes.includes(part.slice(1));
    return node.tag === part.toLowerCase();
  });
}

// ── Parsed print stylesheet ──────────────────────────────────────────────────

const cssWithoutComments = stripComments(css);
const printBlock = extractMediaPrintBlock(cssWithoutComments);
const { rules: printRules, atRules: printAtRules } = parseRules(printBlock ?? '');

const hiddenSelectors = printRules
  .filter((rule) => parseDeclarations(rule.declarations).display === 'none')
  .flatMap((rule) => rule.selectors);

function ruleFor(selector) {
  return printRules.find((rule) => rule.selectors.includes(selector));
}

function subjectsDeclaring(property, value) {
  const subjects = new Set();
  for (const rule of printRules) {
    if (parseDeclarations(rule.declarations)[property] !== value) continue;
    for (const selector of rule.selectors) subjects.add(selectorSubject(selector));
  }
  return subjects;
}

describe('print stylesheet in globals.css', () => {
  it('exposes exactly one @media print block holding the report rules', () => {
    expect(printBlock).not.toBeNull();
    expect(cssWithoutComments.match(/@media\s+print/gi)).toHaveLength(1);
    expect(printRules.length).toBeGreaterThan(0);
  });

  describe('Req 5.7 — chrome is hidden on itself, never on an ancestor of the report', () => {
    it('sets display: none on the app chrome elements themselves', () => {
      for (const chrome of ['.sidebar', '.sidebar-nav', '.toast-container', '.no-print']) {
        expect(hiddenSelectors).toContain(chrome);
      }
      // The app header is hidden as the header element itself, scoped to the
      // shell, rather than by hiding the container that holds the report.
      expect(
        hiddenSelectors.some(
          (selector) => selectorSubject(selector) === 'header' && selector.includes('>'),
        ),
      ).toBe(true);
    });

    it('sets display: none on no ancestor of #report-card-print', () => {
      const offenders = [];
      for (const selector of hiddenSelectors) {
        const subject = selectorSubject(selector);
        for (const ancestor of REPORT_ANCESTORS) {
          if (subjectMatchesAncestor(subject, ancestor)) {
            offenders.push(`"${selector}" would hide ${ancestor.name}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it('sets display: none on no ancestor of a chart canvas inside the report', () => {
      const offenders = [];
      for (const selector of hiddenSelectors) {
        const subject = selectorSubject(selector);
        for (const ancestor of CANVAS_ANCESTORS) {
          if (subjectMatchesAncestor(subject, ancestor)) {
            offenders.push(`"${selector}" would hide ${ancestor.name}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it('keeps the report root and its canvases in flow', () => {
      expect(parseDeclarations(ruleFor('#report-card-print').declarations).display).toBe('block');
      expect(parseDeclarations(ruleFor('#report-card-print canvas').declarations).display).toBe(
        'block',
      );
    });

    it('matches the ancestor chain this test models', () => {
      const shell = readFileSync(APP_SHELL, 'utf8');
      for (const token of ['app-layout', 'dashboard-container', 'dashboard-views']) {
        expect(shell).toContain(token);
      }
      const page = readFileSync(REPORT_PAGE, 'utf8');
      expect(page).toContain('className="dashboard-view active"');
      // The off-screen print mount must stay unclassed; adding `no-print` there
      // would hide an ancestor of the document and print a blank page.
      expect(page).toContain('<div ref={printMountRef} style={OFFSCREEN_PRINT_STYLE}');
    });

    it('recognises an ancestor selector, so the guard above has teeth', () => {
      const views = REPORT_ANCESTORS.find((node) => node.name === '.dashboard-views');
      expect(subjectMatchesAncestor('.dashboard-views', views)).toBe(true);
      expect(subjectMatchesAncestor(selectorSubject('.app-layout > .dashboard-views'), views)).toBe(
        true,
      );
      expect(subjectMatchesAncestor('.sidebar', views)).toBe(false);
    });
  });

  describe('Req 5.9 — page geometry, page breaks and colour rendering', () => {
    it('sets the page size to A4 with 12mm margins', () => {
      const page = printAtRules.find((rule) => /^@page\b/i.test(rule.prelude));
      expect(page, '@page must live inside @media print').toBeDefined();

      const declarations = parseDeclarations(page.body);
      expect(declarations.size).toBe('a4');
      expect(declarations.margin).toBe('12mm');
    });

    it('prevents a page break inside each block of the report document', () => {
      const avoid = subjectsDeclaring('break-inside', 'avoid');
      const avoidLegacy = subjectsDeclaring('page-break-inside', 'avoid');

      for (const block of [
        '.report-doc-header',
        '.report-student-row',
        '.report-section',
        '.report-chart-slot',
        '.report-mastery',
        '.report-remarks-body',
        '.report-signatures',
      ]) {
        expect(avoid, `${block} may straddle a page boundary`).toContain(block);
        expect(avoidLegacy).toContain(block);
      }
    });

    it('sets exact colour rendering on the report root', () => {
      const root = parseDeclarations(ruleFor('#report-card-print').declarations);
      expect(root['print-color-adjust']).toBe('exact');
      expect(root['-webkit-print-color-adjust']).toBe('exact');
    });
  });
});
