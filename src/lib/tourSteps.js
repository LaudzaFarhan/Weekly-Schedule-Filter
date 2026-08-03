/**
 * Tour content.
 *
 * One tour per screen, plus a `welcome` tour that explains the frame the screens
 * hang in. Steps point at elements through `data-tour` attributes rather than
 * class names or nth-child paths, so restyling a panel cannot silently break a
 * tour — and a missing anchor drops the step instead of highlighting nothing
 * (see `visibleSteps`).
 *
 * Copy rules, because a tour that explains the obvious is worse than none:
 *   - Say what the control is *for*, not what it is called. The label already
 *     says what it is called.
 *   - Name the thing people get wrong. Most of these steps exist because someone
 *     was confused by that specific spot.
 *   - Two sentences at most.
 *
 * `version` is per tour. Bump it when the steps change enough that people who
 * already took the tour should be offered it again.
 */

export const TOURS = {
  welcome: {
    id: 'welcome',
    version: 1,
    title: 'Getting around',
    steps: [
      {
        id: 'intro',
        target: null,
        title: 'Welcome to The Lab Operation System',
        body: 'A two minute tour of where things live. You can leave at any time with Escape, and restart it from the ? button in the header.',
      },
      {
        id: 'ops-switcher',
        target: '[data-tour="ops-switcher"]',
        placement: 'right',
        title: 'Two systems, one login',
        body: 'Old Operations reads the Google Sheet. New Operations reads the database and is where current work happens. The sidebar changes completely between them.',
      },
      {
        id: 'nav',
        target: '[data-tour="sidebar-nav"]',
        placement: 'right',
        title: 'Everything is in here',
        body: 'Each entry is a screen. A chevron beside one means it has sub-pages folded underneath — click the chevron to open the group, or the label to go straight in.',
      },
      {
        id: 'schedule',
        target: '[data-tour="nav-schedule"]',
        placement: 'right',
        title: 'Start at the schedule',
        body: 'The weekly grid of who teaches what, and when. Most other screens exist to feed it.',
      },
      {
        id: 'students',
        target: '[data-tour="nav-students"]',
        placement: 'right',
        title: 'The student register',
        body: 'Add and edit students here. A student has to exist here before they can be put in a class.',
      },
      {
        id: 'notifications',
        target: '[data-tour="notifications"]',
        placement: 'bottom',
        title: 'What needs attention',
        body: 'Unallocated students and over-capacity classes surface here. A number on the bell means something is waiting.',
      },
      {
        id: 'help',
        target: '[data-tour="help"]',
        placement: 'bottom',
        title: 'Stuck on a screen?',
        body: 'This button runs the tour for whichever page you are on. It is not the same tour twice — each screen has its own.',
      },
    ],
  },

  schedule: {
    id: 'schedule',
    version: 1,
    title: 'The schedule grid',
    steps: [
      {
        id: 'grid',
        target: '[data-tour="schedule-grid"]',
        placement: 'top',
        title: 'One column per instructor',
        body: 'Rows are half hours. A card covers the rows its class actually occupies, so a 90 minute class fills three of them.',
      },
      {
        id: 'edges',
        target: '[data-tour="schedule-grid"]',
        placement: 'top',
        title: 'Read the card edges, not the labels inside',
        body: 'Times on the left sit on the line they name. A card marked START and END spans from its start line to its end line — the labels inside it are just the rows it passes through.',
      },
      {
        id: 'draw',
        target: '[data-tour="schedule-grid"]',
        placement: 'top',
        title: 'Drag an empty column to book time',
        body: 'Press and drag down over free rows. Release and an Edit button appears on the selection, which is where you choose what goes in it.',
      },
      {
        id: 'card',
        target: '[data-tour="schedule-grid"]',
        placement: 'top',
        title: 'Click a class to open its roster',
        body: 'That is where students are added and removed. Drag a card by its handle to move the class; drag the bar at its bottom edge to make it longer or shorter.',
      },
      {
        id: 'scope',
        target: '[data-tour="student-scope"]',
        placement: 'bottom',
        title: 'Who still needs a class',
        body: 'This list starts on Unallocated — students with no class yet. Switch it to All Students when you need to book an extra session for someone already placed.',
      },
    ],
  },

  'report-cards': {
    id: 'report-cards',
    version: 1,
    title: 'Filling in a report card',
    steps: [
      {
        id: 'selector',
        target: '[data-tour="student-selector"]',
        placement: 'right',
        title: 'Pick a student first',
        body: 'K, J and C filter by programme — Kinder, Junior and Coder. Nothing else on this page does anything until a student is selected.',
      },
      {
        id: 'terms',
        target: '[data-tour="term-badges"]',
        placement: 'bottom',
        title: 'Payment per term',
        body: 'Click a badge to change it. The legend underneath says which colour means what, and the ring marks the term running now.',
      },
      {
        id: 'lesson',
        target: '[data-tour="lesson-picker"]',
        placement: 'bottom',
        title: 'One report per lesson',
        body: 'The number you pick is the report you are editing. Lessons are kept separately, so grading lesson 5 never touches what you entered for lesson 2 — even if both happened on the same day.',
      },
      {
        id: 'form',
        target: '[data-tour="evaluation-form"]',
        placement: 'top',
        title: 'Score the concepts',
        body: 'One to five stars per concept. The reference beside the form says what each score is meant to mean, so two people grade the same way.',
      },
      {
        id: 'radar',
        target: '[data-tour="radar"]',
        placement: 'left',
        title: 'The averages, not the last lesson',
        body: 'This chart averages every lesson recorded so far. It is what goes on the printed card, which is why one weak lesson does not sink the whole report.',
      },
    ],
  },

  students: {
    id: 'students',
    version: 1,
    title: 'The student register',
    steps: [
      {
        id: 'intro',
        target: null,
        title: 'Students live here',
        body: 'This is the source of truth for names, programme and level. The schedule and report cards both read from it, so fix a name here rather than anywhere else.',
      },
    ],
  },
};

/** Tour ids in the order a new user should meet them. */
export const TOUR_ORDER = ['welcome', 'schedule', 'report-cards', 'students'];

/**
 * The tour for a page, if there is one.
 *
 * Report Cards has two sub-pages and they share a tour: the setup screen is a
 * variation on the same job, not a separate one to learn.
 */
export function tourForPage(page) {
  if (!page) return null;
  if (page === 'report-cards-rubric') return TOURS['report-cards'] || null;
  if (page === 'dashboard') return TOURS.home || null;
  return TOURS[page] || null;
}
