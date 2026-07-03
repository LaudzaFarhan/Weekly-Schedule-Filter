import { NextResponse } from 'next/server';
import Papa from 'papaparse';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * GET /api/schedule?sheetUrl=...
 * Server-side fetch of Google Sheets data — no CORS issues!
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let sheetUrl = searchParams.get('sheetUrl');
  const branchId = searchParams.get('branchId') || 'default';
  const branchName = searchParams.get('branchName') || 'Default';

  if (!sheetUrl) {
    return NextResponse.json({ error: 'Missing sheetUrl parameter' }, { status: 400 });
  }

  // Normalize URL to /pub format
  sheetUrl = sheetUrl.trim();
  if (sheetUrl.includes('?')) sheetUrl = sheetUrl.split('?')[0];
  if (sheetUrl.includes('#')) sheetUrl = sheetUrl.split('#')[0];
  if (sheetUrl.endsWith('/pubhtml')) sheetUrl = sheetUrl.replace('/pubhtml', '/pub');
  if (sheetUrl.endsWith('/edit')) sheetUrl = sheetUrl.replace('/edit', '/pub');
  if (!sheetUrl.endsWith('/pub')) sheetUrl = sheetUrl + '/pub';

  try {
    // Step 1: Discover tabs
    const pubHtmlUrl = sheetUrl.replace('/pub', '/pubhtml');
    const tabsResponse = await fetch(pubHtmlUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!tabsResponse.ok) {
      throw new Error(`Failed to fetch sheet tabs: HTTP ${tabsResponse.status}`);
    }
    const html = await tabsResponse.text();

    const tabs = [];
    let match;

    // Try old HTML list format
    const oldRegex = /<li[^>]*id="sheet-button-(\d+)"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/g;
    while ((match = oldRegex.exec(html)) !== null) {
      tabs.push({ gid: match[1], name: match[2].trim() });
    }

    // Try new JS array format if old format failed
    if (tabs.length === 0) {
      const newRegex = /\{name:\s*"([^"]+)"[^}]+gid:\s*"(\d+)"/g;
      while ((match = newRegex.exec(html)) !== null) {
        tabs.push({ gid: match[2], name: match[1].trim() });
      }
    }

    if (tabs.length === 0) {
      return NextResponse.json({ error: 'No tabs found in the sheet' }, { status: 400 });
    }

    // Step 2: Filter day tabs
    const dayTabs = tabs.filter((tab) => {
      const lower = tab.name.toLowerCase();
      const matchedDay = DAY_NAMES.find((day) => lower.includes(day.toLowerCase()));
      if (matchedDay) {
        tab.normalizedDay = matchedDay;
        return true;
      }
      return false;
    });

    if (dayTabs.length === 0) {
      return NextResponse.json({
        error: `No day tabs found. Found tabs: ${tabs.map((t) => t.name).join(', ')}`,
      }, { status: 400 });
    }

    // Step 3: Fetch CSV for each day tab
    const results = await Promise.allSettled(
      dayTabs.map(async (tab) => {
        const csvUrl = `${sheetUrl}?gid=${tab.gid}&single=true&output=csv`;
        const response = await fetch(csvUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'text/csv,text/plain,*/*',
          },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        // Handle redirect
        const csvText = await response.text();
        return { tab, csvText };
      })
    );

    // Step 4: Parse CSV data
    const allClasses = [];
    const teachers = new Set();
    const baseTeachers = new Set();
    const times = {};
    let successCount = 0;
    const failedTabs = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { tab, csvText } = result.value;
        const parsed = parseCSVData(csvText, tab.normalizedDay || tab.name, branchId, branchName);
        allClasses.push(...parsed.classes);
        parsed.teachers.forEach((t) => teachers.add(t));
        parsed.baseTeachers.forEach((t) => baseTeachers.add(t));
        if (!times[tab.normalizedDay || tab.name]) times[tab.normalizedDay || tab.name] = [];
        parsed.times.forEach((t) => {
          if (!times[tab.normalizedDay || tab.name].includes(t)) times[tab.normalizedDay || tab.name].push(t);
        });
        successCount++;
      } else {
        failedTabs.push(result.reason.message);
      }
    }

    if (successCount === 0) {
      return NextResponse.json({ error: 'All tabs failed to load' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      classes: allClasses,
      teachers: [...teachers],
      baseTeachers: [...baseTeachers],
      times,
      syncedTabs: successCount,
      totalTabs: dayTabs.length,
      failedTabs,
    });
  } catch (error) {
    console.error('Schedule sync error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Parse CSV text from a Google Sheets tab into class records.
 * Exact same logic as the existing csvParser.js
 */
function parseCSVData(csvText, dayName, branchId, branchName) {
  const classes = [];
  const teachers = new Set();
  const baseTeachers = new Set();
  const times = new Set();

  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  // Different branch sheets label their columns slightly differently
  // (e.g. "Main Inst/PIC" vs "Main Instructor", "Term-Branch" vs
  // "Term Modul", "Lesson Arrange Date" vs "Lesson Arrange"). Build a
  // normalised header map once so we can resolve each logical field by
  // trying a list of aliases instead of one hardcoded name.
  const headerKeys = parsed.meta?.fields || (parsed.data[0] ? Object.keys(parsed.data[0]) : []);
  const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const headerLookup = {};
  for (const h of headerKeys) headerLookup[normKey(h)] = h;

  /** Resolve the real header for a logical field given candidate aliases. */
  const resolveCol = (aliases) => {
    for (const a of aliases) {
      const real = headerLookup[normKey(a)];
      if (real) return real;
    }
    return null;
  };

  const COL = {
    time: resolveCol(['Time', 'Jam']),
    term: resolveCol(['Term-Branch', 'Term Modul', 'Term Module', 'TermBranch', 'Term', 'Module', 'Modul']),
    instructor: resolveCol(['Main Inst/PIC', 'Main Instructor', 'Main Inst', 'Instructor', 'PIC', 'Pengajar', 'Teacher']),
    student: resolveCol(['Student Name', 'Student', 'Nama Murid', 'Murid', 'Nama Siswa']),
    lessonArrange: resolveCol(['Lesson Arrange Date', 'Lesson Arrange', 'Lesson Arrangement', 'Arrange', 'Lesson Detail']),
    program: resolveCol(['Program', 'Programme']),
    remarks: resolveCol(['Remarks', 'Remark', 'Notes', 'Catatan', 'Keterangan']),
  };

  // Read a logical field from a row via the resolved header.
  const cell = (row, key) => (COL[key] && row[COL[key]] != null ? row[COL[key]] : undefined);

  let lastTime = '';
  let lastTerm = '';
  let lastTeacher = '';
  let lastBaseTeacher = '';

  parsed.data.forEach((row) => {
    const rawStudent = cell(row, 'student');
    const rawTime = cell(row, 'time');
    const rawTerm = cell(row, 'term');

    if (!rawStudent && !rawTime && !rawTerm) return;
    if (rawTime === 'Time' || rawTerm === 'Term-Branch') return;

    let time = rawTime ? rawTime.trim() : lastTime;
    let term = rawTerm ? rawTerm.trim() : lastTerm;

    const rawColumnC = cell(row, 'instructor') ? cell(row, 'instructor').trim() : '';
    let baseTeacher = rawColumnC || lastBaseTeacher;
    let teacher = baseTeacher;

    if (baseTeacher) lastBaseTeacher = baseTeacher;
    if (baseTeacher && baseTeacher !== '-') baseTeachers.add(baseTeacher);

    const lessonArrange = cell(row, 'lessonArrange');
    let lessonDetail = '';
    if (lessonArrange && lessonArrange.includes(',')) {
      const parts = lessonArrange.split(',');
      const assignedInstructor = parts[parts.length - 1].trim();
      if (assignedInstructor && assignedInstructor !== '-') {
        teacher = assignedInstructor;
      }
      // Extract lesson detail (e.g. "K1.10" from "K1.10, Vivi")
      const rawDetail = parts[0].trim();
      if (/^[A-Z]+\d.*\.\d+$/i.test(rawDetail)) {
        lessonDetail = rawDetail;
      }
    } else if (lessonArrange && lessonArrange.trim() && lessonArrange.trim() !== '-') {
      // Bare value with no comma. It may be:
      //   1. A lesson code ("K1.10", "Coder") → keep inherited instructor.
      //   2. A bare instructor name ("Christian") → override instructor.
      //   3. A date or freeform note ("29 May", "ijin 29 May") → ignore;
      //      the inherited Main-Instructor stays the teacher.
      const v = lessonArrange.trim();
      const looksLikeLessonCode =
        /^[A-Z]+\d.*\.\d+$/i.test(v) ||
        /^(coder|trial|reg|k\d|kf\d|j\d|jf\d|cb\d|cd\d)/i.test(v);
      const looksLikeDateOrNote =
        /\d/.test(v) ||  // contains any digit → likely a date/note, not a name
        /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mei|agu|okt|des|izin|ijin|reschedule|pending|done|tba)/i.test(v);
      if (looksLikeLessonCode) {
        if (/^[A-Z]+\d.*\.\d+$/i.test(v)) lessonDetail = v;
        // teacher stays inherited
      } else if (!looksLikeDateOrNote) {
        // Pure name → treat as instructor override.
        teacher = v;
      }
      // else: date/note → leave the inherited teacher untouched
    } else if (!lessonArrange || lessonArrange.trim() === '') {
      if (!rawColumnC) {
        teacher = '';
      }
    }

    if (time.startsWith('010.')) time = time.substring(1);

    if (time) lastTime = time;
    if (term) lastTerm = term;
    if (teacher) lastTeacher = teacher;

    let student = rawStudent ? rawStudent.trim() : '';

    // A lone '-' in Lesson Arrange Date means the student is on leave /
    // izin / not yet scheduled — keep them in the data so the UI can
    // display their status instead of silently dropping them.
    const notArranged = !!(lessonArrange && lessonArrange.trim() === '-');

    if (student && teacher && time) {
      classes.push({
        day: dayName,
        branchId,
        branchName,
        time,
        program: term,
        teacher,
        student,
        remarks: cell(row, 'remarks') || '',
        fullProgram: cell(row, 'program') || '',
        lessonDetail,
        notArranged,
        date: lessonArrange ? lessonArrange.trim() : '',
      });

      if (teacher !== '-') teachers.add(teacher);
      times.add(time);
    }
  });

  return { classes, teachers: [...teachers], baseTeachers: [...baseTeachers], times: [...times] };
}
