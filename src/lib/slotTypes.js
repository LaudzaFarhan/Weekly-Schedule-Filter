/**
 * Slot kinds usable in a day's class operation plan.
 *
 * Class kinds are bookable; the rest (break / training / meeting) block the
 * time for everyone. Lives in its own module so both the Operationals page and
 * the schedule grid can read it without importing each other.
 */
export const SLOT_TYPES = [
  { key: 'kinder',   label: 'Kinder Class',   category: 'Kinder', bookable: true,  color: '#ea580c', bg: 'rgba(249,115,22,0.1)' },
  { key: 'junior',   label: 'Junior Class',   category: 'Junior', bookable: true,  color: '#0891b2', bg: 'rgba(8,145,178,0.1)' },
  { key: 'coder',    label: 'Coder Class',    category: 'Coder',  bookable: true,  color: '#4f46e5', bg: 'rgba(79,70,229,0.1)' },
  { key: 'any',      label: 'Any Class',      category: null,     bookable: true,  color: '#059669', bg: 'rgba(5,150,105,0.1)' },
  { key: 'break',    label: 'Break',          category: null,     bookable: false, color: '#b45309', bg: 'rgba(245,158,11,0.12)' },
  { key: 'training', label: 'Training',       category: null,     bookable: false, color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' },
  { key: 'meeting',  label: 'Meeting',        category: null,     bookable: false, color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
];

export const slotTypeMeta = (key) =>
  SLOT_TYPES.find((t) => t.key === key) || SLOT_TYPES[SLOT_TYPES.length - 1];

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
