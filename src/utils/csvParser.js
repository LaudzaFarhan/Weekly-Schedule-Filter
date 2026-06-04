import Papa from 'papaparse';

const VALID_LEVELS = [
  'Kinder Foundation',
  'Kinder',
  'Junior Foundation',
  'Junior',
  'Basic 1',
  'Basic 2',
  'Intermediate 1',
  'Intermediate 2',
  'Advance 1',
  'Advance 2',
  'Advance 3'
];

function extractLevel(raw) {
  if (!raw) return '';
  const lowerRaw = raw.toLowerCase();
  // Match most specific first (e.g. 'Kinder Foundation' before 'Kinder')
  const sortedLevels = [...VALID_LEVELS].sort((a, b) => b.length - a.length);
  for (const lvl of sortedLevels) {
    if (lowerRaw.includes(lvl.toLowerCase())) {
      return lvl;
    }
  }
  return '';
}

function isValidTeacherName(name) {
  if (!name || name === '-') return false;
  const lower = name.toLowerCase();
  if (lower.startsWith('http')) return false;
  if (lower.includes('not assigned')) return false;
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  if (days.includes(lower)) return false;
  return true;
}

const ALIASES = {
  'Time': ['time', 'jam'],
  'Term-Branch': ['term-branch', 'term modul', 'term module', 'term', 'module', 'modul'],
  'Main Inst/PIC': ['main inst/pic', 'main instructor', 'main inst', 'instructor', 'pic', 'pengajar', 'teacher'],
  'Student Name': ['student name', 'student', 'nama murid', 'murid', 'nama siswa'],
  'Lesson Arrange Date': ['lesson arrange date', 'lesson arrange', 'lesson arrangement', 'arrange', 'lesson detail'],
  'Program': ['program', 'programme'],
  'Remarks': ['remarks', 'remark', 'notes', 'catatan', 'keterangan']
};

function normalizeRow(rawRow) {
  const normalized = {};
  for (const [rawKey, val] of Object.entries(rawRow)) {
    const lowerKey = (rawKey || '').toLowerCase().trim();
    let matched = false;
    for (const [stdKey, aliases] of Object.entries(ALIASES)) {
      if (aliases.includes(lowerKey)) {
        normalized[stdKey] = val;
        matched = true;
        break;
      }
    }
    if (!matched) {
      normalized[rawKey] = val; // keep unknown columns just in case
    }
  }
  return normalized;
}

/**
 * Parse CSV text from a Google Sheets tab into class records.
 */
export function parseCSVData(csvText, dayName) {
  const classes = [];
  const teachers = new Set();
  const baseTeachers = new Set();
  const times = new Set();

  Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    complete(results) {
      let lastTime = '';
      let lastTerm = '';
      let lastTeacher = '';
      let lastBaseTeacher = '';

      results.data.forEach((rawRow) => {
        const row = normalizeRow(rawRow);
        
        if (!row['Student Name'] && !row['Time'] && !row['Term-Branch']) return;
        if (row['Time'] === 'Time' || row['Term-Branch'] === 'Term-Branch') return;

        let time = row['Time'] ? row['Time'].trim() : lastTime;
        let term = row['Term-Branch'] ? row['Term-Branch'].trim() : lastTerm;

        const rawColumnC = row['Main Inst/PIC'] ? row['Main Inst/PIC'].trim() : '';
        let baseTeacher = rawColumnC || lastBaseTeacher;
        let teacher = baseTeacher;

        if (baseTeacher) lastBaseTeacher = baseTeacher;
        if (baseTeacher && baseTeacher !== '-') baseTeachers.add(baseTeacher);

        const lessonArrange = row['Lesson Arrange Date'];
        let lessonDetail = '';
        if (lessonArrange && lessonArrange.includes(',')) {
          const parts = lessonArrange.split(',');
          const assignedInstructor = parts[parts.length - 1].trim();
          if (isValidTeacherName(assignedInstructor)) {
            teacher = assignedInstructor;
          }
          // Extract lesson detail (e.g. "K1.10" from "K1.10, Vivi")
          const rawDetail = parts[0].trim();
          if (/^[A-Z]+\d.*\.\d+$/i.test(rawDetail)) {
            lessonDetail = rawDetail;
          }
        } else if (lessonArrange && lessonArrange.trim() && lessonArrange.trim() !== '-') {
          // Bare value in column F with no comma. Two shapes are possible:
          //   1. A lesson code (e.g. "K1.10", "JF2.5", "Coder") — we keep
          //      the inherited instructor and just record the lesson detail.
          //   2. An instructor name (used for Coder rows where the column
          //      simply credits a different instructor — "Christian", etc.)
          //      — we override the inherited instructor.
          const v = lessonArrange.trim();
          const looksLikeLessonCode =
            /^[A-Z]+\d.*\.\d+$/i.test(v) ||  // KF1.5, J2.10
            /^(coder|trial|reg|k\d|kf\d|j\d|jf\d|cb\d|cd\d)/i.test(v);
          if (looksLikeLessonCode) {
            if (/^[A-Z]+\d.*\.\d+$/i.test(v)) lessonDetail = v;
            // teacher stays as inherited baseTeacher — that's the rule
          } else if (isValidTeacherName(v)) {
            // Treat as instructor name override.
            teacher = v;
          }
        } else if (!lessonArrange || lessonArrange.trim() === '') {
          if (!rawColumnC) {
            teacher = '';
          }
        }

        if (time.startsWith('010.')) time = time.substring(1);

        if (time) lastTime = time;
        if (term) lastTerm = term;
        if (teacher) lastTeacher = teacher;

        let student = row['Student Name'] ? row['Student Name'].trim() : '';

        // A lone '-' in Lesson Arrange Date means the student is on leave /
        // izin / not yet scheduled — keep them in the data so the UI can
        // display their status instead of silently dropping them.
        const notArranged = !!(lessonArrange && lessonArrange.trim() === '-');

        if (student && teacher && time) {
          classes.push({
            day: dayName,
            time,
            program: term,
            teacher,
            student,
            remarks: row['Remarks'] || '',
            fullProgram: extractLevel(row['Program'] || ''),
            lessonDetail,
            notArranged,
          });

          if (isValidTeacherName(teacher)) teachers.add(teacher);
          times.add(time);
        }
      });
    },
  });

  return { classes, teachers, baseTeachers, times };
}
