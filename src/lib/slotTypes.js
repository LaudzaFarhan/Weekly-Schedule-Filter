/**
 * Slot kinds usable in a day's class operation plan.
 *
 * Class kinds are bookable; the rest (break / training / meeting) block the
 * time for everyone. Lives in its own module so both the Operationals page and
 * the schedule grid can read it without importing each other.
 */
export const SLOT_TYPES = [
  { key: 'kinder',   label: 'Kinder Class',   category: 'Kinder', bookable: true,  color: '#d97706', border: '#f59e0b', bg: '#fef08a', text: '#78350f' },
  { key: 'junior',   label: 'Junior Class',   category: 'Junior', bookable: true,  color: '#0284c7', border: '#38bdf8', bg: '#e0f2fe', text: '#0369a1' },
  { key: 'coder',    label: 'Coder Class',    category: 'Coder',  bookable: true,  color: '#60a5fa', border: '#1e3a8a', bg: '#0f172a', text: '#ffffff', isDark: true },
  { key: 'any',      label: 'Any Class',      category: null,     bookable: true,  color: '#059669', border: '#10b981', bg: 'rgba(5,150,105,0.15)', text: '#065f46' },
  { key: 'break',    label: 'Break',          category: null,     bookable: false, color: '#b45309', border: '#f59e0b', bg: 'rgba(245,158,11,0.12)', text: '#92400e' },
  { key: 'training', label: 'Training',       category: null,     bookable: false, color: '#7c3aed', border: '#8b5cf6', bg: 'rgba(124,58,237,0.12)', text: '#5b21b6' },
  { key: 'meeting',  label: 'Meeting',        category: null,     bookable: false, color: '#dc2626', border: '#ef4444', bg: 'rgba(220,38,38,0.12)', text: '#991b1b' },
];

export const slotTypeMeta = (key) =>
  SLOT_TYPES.find((t) => t.key === key) || SLOT_TYPES[SLOT_TYPES.length - 1];

/** Category color definitions for Schedule Grid: Kinder (Yellow), Junior (Light Blue), Coder (Navy) */
export function getCategoryColorStyle(category) {
  const cat = String(category || '').toLowerCase();

  if (cat.includes('kinder') || cat === 'k') {
    return {
      key: 'kinder',
      label: 'Kinder',
      color: '#d97706',
      border: '#f59e0b',
      bg: '#fef08a',
      pillBg: '#fef08a',
      pillColor: '#78350f',
      textColor: '#78350f',
      subtextColor: '#854d0e',
      badgeBg: 'rgba(217, 119, 6, 0.18)',
    };
  }

  if (cat.includes('junior') || cat === 'j') {
    return {
      key: 'junior',
      label: 'Junior',
      color: '#0284c7',
      border: '#38bdf8',
      bg: '#e0f2fe',
      pillBg: '#e0f2fe',
      pillColor: '#0369a1',
      textColor: '#0369a1',
      subtextColor: '#075985',
      badgeBg: 'rgba(2, 132, 199, 0.15)',
    };
  }

  if (cat.includes('coder') || cat === 'c') {
    return {
      key: 'coder',
      label: 'Coder',
      color: '#60a5fa',
      border: '#1e3a8a',
      bg: '#0f172a',
      pillBg: '#1e3a8a',
      pillColor: '#ffffff',
      textColor: '#ffffff',
      subtextColor: '#cbd5e1',
      badgeBg: 'rgba(30, 58, 138, 0.85)',
      isDark: true,
    };
  }

  return {
    key: 'any',
    label: 'Any',
    color: '#059669',
    border: '#10b981',
    bg: 'rgba(5, 150, 105, 0.15)',
    pillBg: '#d1fae5',
    pillColor: '#065f46',
    textColor: '#065f46',
    subtextColor: '#047857',
    badgeBg: 'rgba(5, 150, 105, 0.15)',
  };
}

/** The slot key that opens a class of the given category. */
export const slotKeyForCategory = (category) =>
  SLOT_TYPES.find((t) => t.bookable && t.category === category)?.key || 'any';

/** Standard length in minutes of a class in this category. */
export const durationForCategory = (category) => (category === 'Kinder' ? 90 : 120);

/**
 * Non-class sessions that can be planned into a day: they block the time
 * rather than taking students.
 */
export const SESSION_TYPES = SLOT_TYPES.filter((t) => !t.bookable);

/**
 * Can this slot kind name a single instructor?
 *
 * Training and meetings are often for one person, so they only block that
 * person's column. A break belongs to the whole branch and is owned by the
 * day's Hours & Break settings, so it stays unassigned.
 */
export const isInstructorScoped = (type) => type === 'training' || type === 'meeting';

