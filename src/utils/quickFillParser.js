/**
 * Quick Fill parser for the Trial Input page.
 *
 * Reads free-form chatbot transcripts in either Indonesian or English and
 * extracts the data we need to pre-fill the trial form. Branch detection is
 * data-driven — every name from the live `branches` config (plus any aliases)
 * gets matched against the text, so adding a new branch in Admin → Branches
 * automatically extends the parser.
 *
 * Recognised fields:
 *   • Student / Anak / Nama        → student name
 *   • Parent / Orang tua / Ibu / Bapak → parent name (kept in remarks)
 *   • Phone / WA / Nomor / Telp    → contact (kept in remarks)
 *   • Age / Umur / Usia            → infers program (Kinder / Junior / Coder)
 *   • Program / Trial              → explicit program override
 *   • Date / Tanggal               → trial date (multiple formats)
 *   • Time / Jam / Waktu           → 1-hour slot starting at the given time
 *   • Branch / Cabang / Lokasi     → matches branch name or alias
 *   • Experience / Pengalaman      → kept in remarks
 *   • Notes / Catatan              → kept in remarks
 *
 * Lines that don't match a known key are appended to remarks so nothing from
 * the chatbot transcript is silently dropped.
 */

import { DAY_NAMES } from './constants';

/* ─── Field detectors ──────────────────────────────────────────── */

// Each entry: keyword regex (matches a line's "key: value" prefix).
// Order matters — we test in this order and stop at the first match.
const FIELD_PATTERNS = {
  student: /^(student|anak|nama\s*(anak|murid|siswa)?|child)\b/i,
  parent: /^(parent|orang\s*tua|ibu|bapak|ayah|mama|papa)\b/i,
  phone: /^(phone|wa|whatsapp|hp|no\.?\s*(hp|wa|telp)|nomor|telp|kontak|contact)\b/i,
  age: /^(age|umur|usia)\b/i,
  program: /^(program|trial|kelas|level)\b/i,
  date: /^(date|tanggal|tgl|jadwal\s*tanggal|trial\s*date)\b/i,
  time: /^(time|jam|waktu|trial\s*time|jadwal\s*jam)\b/i,
  branch: /^(branch|cabang|lokasi|location|tempat|cab)\b/i,
  experience: /^(experience|pengalaman|background|riwayat)\b/i,
  notes: /^(notes?|catatan|keterangan|remarks?|info)\b/i,
};

/* ─── Helpers ──────────────────────────────────────────────────── */

/** Normalise a string for fuzzy matching: lowercase + collapse whitespace. */
function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Convert "1pm" / "13.30" / "1.30 sore" / "5" (afternoon-implied) into a
 * concrete hour + minute pair (24h clock). Returns null if unparseable.
 */
function parseLooseTime(value) {
  const lower = String(value || '').toLowerCase();
  if (!lower) return null;

  // Indonesian period words → AM/PM hint
  const isIDPagi = /\b(pagi)\b/.test(lower);
  const isIDSiang = /\b(siang)\b/.test(lower);
  const isIDSore = /\b(sore|petang)\b/.test(lower);
  const isIDMalam = /\b(malam)\b/.test(lower);
  const explicitPM = /\bpm\b/.test(lower) || isIDSiang || isIDSore || isIDMalam;
  const explicitAM = /\bam\b/.test(lower) || isIDPagi;

  const match = lower.match(/(\d{1,2})[:.]?(\d{2})?/);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  let min = match[2] ? parseInt(match[2], 10) : 0;
  if (isNaN(hour) || hour < 0 || hour > 23) return null;
  if (isNaN(min) || min < 0 || min > 59) min = 0;

  if (explicitPM && hour < 12) hour += 12;
  if (explicitAM && hour === 12) hour = 0;
  // Fallback: hours 1–6 with no marker default to PM (school's afternoon hours).
  if (!explicitAM && !explicitPM && hour >= 1 && hour <= 6) hour += 12;

  return { hour, min };
}

/** Format a 24h hour/minute pair into the app's slot string ("1.00 - 2.00 pm"). */
function formatHourSlot(hour, min) {
  const formatTime = (h, m) => {
    const isPM = h >= 12;
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    const ampm = isPM ? 'pm' : 'am';
    return `${displayH}.${String(m).padStart(2, '0')} ${ampm}`;
  };
  const startStr = formatTime(hour, min);
  const endHour = hour + 1;
  const endStr = formatTime(endHour, min);
  const startIsPM = hour >= 12;
  const endIsPM = endHour >= 12;
  if (startIsPM === endIsPM) {
    // Strip the AM/PM from the start side when both are on the same side of noon
    return `${startStr.replace(/ am| pm/g, '')} - ${endStr}`;
  }
  return `${startStr} - ${endStr}`;
}

/**
 * Parse a date value coming from the chatbot. Accepts:
 *   • ISO (YYYY-MM-DD)
 *   • "21 December 2025"
 *   • "21/12/2025" or "21-12-2025" (DMY — Indonesian convention)
 *   • "Dec 21" (year defaults to current)
 *
 * Returns a Date object (local midnight) or null.
 */
function parseLooseDate(value) {
  const v = String(value || '').trim();
  if (!v) return null;

  // 1. ISO first (browser-native)
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) {
    const d = new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  // 2. DMY / DM with separators (Indonesian): 21/12/2025, 21-12, 21.12.25
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/.exec(v);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    let year = dmy[3] ? parseInt(dmy[3], 10) : new Date().getFullYear();
    if (year < 100) year += 2000; // 25 → 2025
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  // 3. Last resort: native parser handles "21 December 2025", "Dec 21", etc.
  const native = new Date(v);
  return isNaN(native.getTime()) ? null : native;
}

/**
 * Find which branch the chatbot text refers to. Matches against the branch
 * `name` plus any provided aliases. Returns the matching branch or null.
 *
 * @param {string} text - The full chatbot transcript or just the value side.
 * @param {Array} branches - [{ id, name, aliases?: string[] }]
 */
function detectBranch(text, branches) {
  if (!branches || branches.length === 0) return null;
  const haystack = norm(text);
  if (!haystack) return null;

  // Score each branch by the longest matching keyword — longest match wins
  // so "Pondok Indah Mall" beats "Mall" and "Gading Serpong" beats "Gading".
  let best = null;
  let bestLen = 0;
  for (const b of branches) {
    const candidates = [b.name, ...(b.aliases || [])].filter(Boolean);
    for (const cand of candidates) {
      const candNorm = norm(cand);
      if (!candNorm) continue;
      // Word-boundary-ish check: the candidate must appear as a contiguous
      // substring in the haystack. This catches "puri indah" inside a longer
      // sentence like "trial di puri indah".
      if (haystack.includes(candNorm) && candNorm.length > bestLen) {
        best = b;
        bestLen = candNorm.length;
      }
    }
  }
  return best;
}

/** Map an age number to a Trial program. */
function programForAge(age) {
  if (age >= 4 && age <= 7) return 'Trial Kinder';
  if (age >= 8 && age <= 10) return 'Trial Junior';
  if (age >= 11) return 'Trial Coder';
  return null;
}

/** Day-of-week derivation; Sunday is left blank because we don't operate that day. */
function dayNameFromDate(d) {
  if (!d || isNaN(d.getTime())) return '';
  const dow = d.getDay();
  if (dow === 0) return ''; // Sunday — caller should reject
  return DAY_NAMES[dow - 1];
}

/* ─── Main parser ─────────────────────────────────────────────── */

/**
 * Parse a free-form chatbot transcript into structured trial data.
 *
 * @param {string} text
 * @param {Object} options
 * @param {Array} options.branches  Live branches from ScheduleContext (with optional `aliases`).
 * @returns {{
 *   student?: string,
 *   parent?: string,
 *   phone?: string,
 *   age?: number,
 *   program?: string,
 *   date?: string,            // YYYY-MM-DD
 *   day?: string,             // Monday..Saturday
 *   time?: string,            // "1.00 - 2.00 pm"
 *   branchName?: string,
 *   branchId?: string,
 *   remarks: string,
 *   warnings: string[],       // messages to surface in the toast
 *   unknownLines: string[],   // lines that didn't match a key, kept for inspection
 * }}
 */
export function parseQuickFill(text, { branches = [] } = {}) {
  const result = {
    remarks: '',
    warnings: [],
    unknownLines: [],
  };

  if (!text || !text.trim()) return result;

  const lines = text.split(/\r?\n/);
  const remarkBuckets = []; // [{ key, value }] preserving order for the remarks textarea

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const colonIdx = line.search(/[:=\-–]/);
    const hasSeparator = colonIdx > 0;
    const key = hasSeparator ? line.slice(0, colonIdx).trim() : '';
    const value = hasSeparator ? line.slice(colonIdx + 1).trim() : line;

    let matched = false;
    for (const [field, pattern] of Object.entries(FIELD_PATTERNS)) {
      if (!pattern.test(key)) continue;
      matched = true;
      switch (field) {
        case 'student':
          if (!result.student) result.student = value;
          break;
        case 'parent':
          if (!result.parent) result.parent = value;
          remarkBuckets.push({ key: 'Parent', value });
          break;
        case 'phone':
          if (!result.phone) result.phone = value;
          remarkBuckets.push({ key: 'Phone', value });
          break;
        case 'age': {
          const num = parseInt(value, 10);
          if (!isNaN(num)) {
            result.age = num;
            const prog = programForAge(num);
            if (prog && !result.program) result.program = prog;
          }
          break;
        }
        case 'program': {
          const v = value.toLowerCase();
          if (v.includes('kinder')) result.program = 'Trial Kinder';
          else if (v.includes('junior')) result.program = 'Trial Junior';
          else if (v.includes('coder')) result.program = 'Trial Coder';
          else result.program = value; // keep raw if unrecognised
          break;
        }
        case 'date': {
          const d = parseLooseDate(value);
          if (d) {
            const yr = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const da = String(d.getDate()).padStart(2, '0');
            result.date = `${yr}-${mo}-${da}`;
            const dn = dayNameFromDate(d);
            if (dn) {
              result.day = dn;
            } else {
              result.warnings.push('Trial date falls on Sunday — please reschedule.');
            }
          } else {
            result.warnings.push(`Could not parse date "${value}".`);
          }
          break;
        }
        case 'time': {
          const t = parseLooseTime(value);
          if (t) {
            result.time = formatHourSlot(t.hour, t.min);
          } else {
            result.warnings.push(`Could not parse time "${value}".`);
          }
          break;
        }
        case 'branch': {
          const branch = detectBranch(value, branches);
          if (branch) {
            result.branchName = branch.name;
            result.branchId = branch.id;
          } else {
            result.warnings.push(`Branch "${value}" did not match any configured branch.`);
            // Still preserve raw text in remarks
            remarkBuckets.push({ key: 'Branch', value });
          }
          break;
        }
        case 'experience':
        case 'notes':
          remarkBuckets.push({ key: key, value });
          break;
        default:
          break;
      }
      break; // one field per line
    }

    if (!matched) {
      result.unknownLines.push(line);
      // Keep unknown free text in remarks too — don't lose context.
      remarkBuckets.push({ key: '', value: line });
    }
  }

  // If branch wasn't tagged via a "Branch:" line, scan the entire transcript
  // as a fallback. This is what catches "trial di Gading Serpong" inside a
  // free-form chatbot message.
  if (!result.branchName) {
    const branch = detectBranch(text, branches);
    if (branch) {
      result.branchName = branch.name;
      result.branchId = branch.id;
    }
  }

  // Compose remarks: structured key-value pairs first, then any leftover
  // free text. Skip empty values so the textarea stays tidy.
  result.remarks = remarkBuckets
    .filter((b) => b.value)
    .map((b) => (b.key ? `${b.key}: ${b.value}` : b.value))
    .join('\n');

  return result;
}
