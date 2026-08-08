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

  // Feature-specific tours launched from FeatureTutorialSidebar
  'sidebar-space': {
    id: 'sidebar-space',
    version: 1,
    title: 'Hide & Show Sidebar Space',
    steps: [
      {
        id: 'toggle-collapse',
        pageId: 'schedule',
        target: '[data-tour="sidebar-toggle"]',
        placement: 'right',
        title: 'Collapse Sidebar',
        body: 'Click this button inside the sidebar header to collapse the navigation panel and maximize your screen space.',
      },
      {
        id: 'toggle-expand',
        pageId: 'schedule',
        target: '[data-tour="sidebar-toggle-expand"]',
        placement: 'right',
        title: 'Expand Sidebar',
        body: 'When collapsed, click this top-left icon button anytime to restore the navigation menu back into full view.',
      },
    ],
  },

  'master-schedule': {
    id: 'master-schedule',
    version: 1,
    title: 'Master Schedule Grid',
    steps: [
      {
        id: 'branch',
        pageId: 'schedule',
        target: '[data-tour="branch-filter"]',
        placement: 'bottom',
        title: '1. Select Branch Location',
        body: 'Use this branch dropdown to filter schedule classes for Puri Indah, Bekasi, Bintaro, Gading Serpong, or BSD.',
      },
      {
        id: 'add-btn',
        pageId: 'schedule',
        target: '[data-tour="add-class-btn"]',
        placement: 'bottom',
        title: '2. Add Class or Trial',
        body: 'Click + Add Class to open the booking dialog for regular, trial, or replacement student sessions.',
      },
      {
        id: 'grid',
        pageId: 'schedule',
        target: '[data-tour="schedule-grid"]',
        placement: 'top',
        title: '3. Weekly Timetable Grid',
        body: 'Columns represent active instructors and rows are 30-minute slots. Click any class card to view or edit rosters.',
      },
      {
        id: 'scope',
        pageId: 'schedule',
        target: '[data-tour="student-scope"]',
        placement: 'left',
        title: '4. Unallocated Students Sidebar',
        body: 'View students needing class placement and click any student name for smart day recommendations.',
      },
    ],
  },

  'unallocated-students': {
    id: 'unallocated-students',
    version: 1,
    title: 'Unallocated Students & Placement',
    steps: [
      {
        id: 'scope',
        pageId: 'schedule',
        target: '[data-tour="student-scope"]',
        placement: 'left',
        title: '1. Unallocated Students List',
        body: 'Students registered without an active weekly class stay listed here.',
      },
      {
        id: 'grid',
        pageId: 'schedule',
        target: '[data-tour="schedule-grid"]',
        placement: 'top',
        title: '2. Allocate to Open Slot',
        body: 'Click a student to view open day recommendations, then choose an instructor time slot to allocate.',
      },
    ],
  },

  'slot-checker': {
    id: 'slot-checker',
    version: 1,
    title: 'Slot Checker & Trial Availability',
    steps: [
      {
        id: 'checker',
        pageId: 'trial-availability',
        target: '[data-tour="availability-checker"]',
        placement: 'bottom',
        title: '1. Trial Slot Overview',
        body: 'Overview of available trial seats per time slot, updated live from New Operations schedule data.',
      },
      {
        id: 'slots',
        pageId: 'trial-availability',
        target: '[data-tour="availability-slots"]',
        placement: 'top',
        title: '2. Check Seat Capacity',
        body: 'View open seat capacity per program level (Kinder, Junior, Coder) to answer parent trial inquiries instantly.',
      },
    ],
  },

  'workload': {
    id: 'workload',
    version: 1,
    title: 'Instructor Workload & Hours',
    steps: [
      {
        id: 'header',
        pageId: 'workload',
        target: '[data-tour="workload-header"]',
        placement: 'bottom',
        title: '1. Workload Summary',
        body: 'View total teaching hours, active teaching staff count, and overloaded instructor alerts.',
      },
      {
        id: 'branch-filter',
        pageId: 'workload',
        target: '[data-tour="workload-branch-filter"]',
        placement: 'bottom',
        title: '2. Filter by Home Branch',
        body: 'Select a branch to view teaching staff assigned to that location based on official instructor profiles.',
      },
      {
        id: 'heatmap',
        pageId: 'workload',
        target: '[data-tour="workload-table"]',
        placement: 'top',
        title: '3. Weekly Load Heatmap',
        body: 'Review color-coded daily teaching hour heatmaps to identify underloaded or overloaded teachers.',
      },
    ],
  },

  'instructors-registry': {
    id: 'instructors-registry',
    version: 1,
    title: 'Instructors Registry & Profiles',
    steps: [
      {
        id: 'table',
        pageId: 'instructors',
        target: '[data-tour="instructors-table"]',
        placement: 'top',
        title: '1. Instructors Directory',
        body: 'Official source of truth for active teachers, home branch allocations, employment types, and verified nicknames.',
      },
      {
        id: 'add-btn',
        pageId: 'instructors',
        target: '[data-tour="add-instructor-btn"]',
        placement: 'bottom',
        title: '2. Add Instructor Profile',
        body: 'Click + Add Instructor to register a new teacher, assign verified aliases, and set teaching levels.',
      },
    ],
  },

  'leave-management': {
    id: 'leave-management',
    version: 1,
    title: 'Leave Management & Substitutes',
    steps: [
      {
        id: 'nav',
        pageId: 'leave',
        target: '[data-tour="nav-leave"]',
        placement: 'right',
        title: '1. Leave Management',
        body: 'Log teacher leave requests, track absent dates, and assign substitute cover instructors.',
      },
    ],
  },

  'student-database': {
    id: 'student-database',
    version: 1,
    title: 'Student Database & Register',
    steps: [
      {
        id: 'table',
        pageId: 'students',
        target: '[data-tour="students-table"]',
        placement: 'top',
        title: '1. Student Register',
        body: 'Central directory for student profiles, parent contact numbers, and academic levels.',
      },
      {
        id: 'add-btn',
        pageId: 'students',
        target: '[data-tour="add-student-btn"]',
        placement: 'bottom',
        title: '2. Add Student',
        body: 'Click + Add Student to create a student profile before assigning them to a weekly class.',
      },
    ],
  },

  'crm-leads': {
    id: 'crm-leads',
    version: 1,
    title: 'CRM Leads & Pipeline',
    steps: [
      {
        id: 'pipeline',
        pageId: 'crm',
        target: '[data-tour="crm-pipeline"]',
        placement: 'bottom',
        title: '1. Lead Pipeline',
        body: 'Track parent trial inquiries across stages (Interest Trial, No Response, Trial Booked, Closed).',
      },
      {
        id: 'add-btn',
        pageId: 'crm',
        target: '[data-tour="add-lead-btn"]',
        placement: 'bottom',
        title: '2. Add New Lead',
        body: 'Click + Add Lead to record new parent inquiries from WhatsApp or manual walk-ins.',
      },
    ],
  },

  'trial-priority': {
    id: 'trial-priority',
    version: 1,
    title: 'Trial Priority Overview',
    steps: [
      {
        id: 'nav',
        pageId: 'schedule',
        target: '[data-tour="nav-schedule"]',
        placement: 'right',
        title: '1. Trial Priority',
        body: 'Prioritize incoming trial class bookings based on branch seat urgency.',
      },
    ],
  },

  'live-progress': {
    id: 'live-progress',
    version: 1,
    title: 'Live Progress Trackers',
    steps: [
      {
        id: 'nav',
        pageId: 'progress-kinder',
        target: '[data-tour="sidebar-nav"]',
        placement: 'right',
        title: '1. Live Progress Trackers',
        body: 'Track lesson-by-lesson module completions for Kinder, Junior, and Coder students.',
      },
    ],
  },

  // Not a page tour, so it is absent from TOUR_ORDER and from tourForPage. It is
  // offered automatically by the sunset rule in chooseAutoTour, and on demand by
  // the banner's own button.
  'ops-sunset': {
    id: 'ops-sunset',
    version: 1,
    title: 'Moving to New Operations',
    steps: [
      {
        id: 'why',
        target: '[data-tour="sunset-banner"]',
        placement: 'bottom',
        title: 'Old Operations is being retired',
        body: 'This strip counts down to the date it closes. It changes wording as the date gets closer, and it only appears while you are in Old Operations.',
      },
      {
        id: 'switch',
        target: '[data-tour="ops-switcher"]',
        placement: 'right',
        title: 'New Operations is the one to use',
        body: 'Press the right half of this pill. The sidebar changes completely — New Operations reads the database rather than the Google Sheet, so it is the side with current data.',
      },
      {
        id: 'where',
        target: '[data-tour="sidebar-nav"]',
        placement: 'right',
        title: 'Everything has a home over there',
        body: 'Schedule, students, report cards and CRM all have New Operations versions. If a screen you use daily looks missing, it is folded into a group with a chevron.',
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
  if (page === 'report-cards-rubric' || page === 'report-cards-list') return TOURS['report-cards'] || null;
  if (page === 'dashboard') return TOURS.home || null;
  return TOURS[page] || null;
}
