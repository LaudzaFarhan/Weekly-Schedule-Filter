import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import { getAllConfig, isConfigured } from '@/lib/googleSheets';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const CHATBOT_KEY = process.env.CHATBOT_API_KEY || 'test-qontak-key-123';
const CRM_KEY = process.env.CRM_API_KEY || 'crm-secure-key-12345';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'weekly-schedule-chatbot';
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyAmeryoAv6Nisk7foNUPOAQ3WIfYUajyOQ';

const DEFAULT_SHEET_URL = process.env.NEXT_PUBLIC_DEFAULT_SHEET_URL ||
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vS2ZEndjqsEzgvblfHF44IPQmJQRVHo65zzOya727KEZ0HjtmhXNAmXgzDXTPtGt9q3A02RqG0EV-7d/pubhtml';

const DEFAULT_BRANCHES = [
  { id: 'default', name: 'Default Branch', url: DEFAULT_SHEET_URL }
];

/**
 * Unpacks Firestore REST API fields into a standard JavaScript object
 */
function unpackFirestoreFields(fields) {
  const obj = {};
  if (!fields) return obj;
  for (const [key, value] of Object.entries(fields)) {
    if (value.stringValue !== undefined) {
      obj[key] = value.stringValue;
    } else if (value.booleanValue !== undefined) {
      obj[key] = value.booleanValue;
    } else if (value.integerValue !== undefined) {
      obj[key] = parseInt(value.integerValue, 10);
    } else if (value.doubleValue !== undefined) {
      obj[key] = parseFloat(value.doubleValue);
    } else if (value.timestampValue !== undefined) {
      obj[key] = value.timestampValue;
    } else if (value.arrayValue !== undefined) {
      obj[key] = (value.arrayValue.values || []).map(v => {
        if (v.stringValue !== undefined) return v.stringValue;
        return v;
      });
    } else if (value.mapValue !== undefined) {
      obj[key] = unpackFirestoreFields(value.mapValue.fields);
    }
  }
  return obj;
}

/**
 * Fetches all instructor profiles from Firestore using standard REST API
 */
async function fetchInstructorProfilesRest() {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/instructorProfiles?key=${API_KEY}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      console.warn(`Firestore REST API returned ${response.status} when fetching profiles`);
      return [];
    }
    const data = await response.json();
    return (data.documents || []).map(doc => {
      const fields = unpackFirestoreFields(doc.fields);
      const email = doc.name.split('/').pop();
      return { id: email, email, ...fields };
    });
  } catch (err) {
    console.error('Failed to fetch instructor profiles via REST:', err);
    return [];
  }
}

/**
 * Parses a tab's CSV text from Google Sheets into class records
 */
function parseCSVData(csvText, dayName, branchId, branchName) {
  const classes = [];
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const headerKeys = parsed.meta?.fields || (parsed.data[0] ? Object.keys(parsed.data[0]) : []);
  const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const headerLookup = {};
  for (const h of headerKeys) headerLookup[normKey(h)] = h;

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
    remarks: resolveCol(['Remarks', 'Remark', 'Notes', 'Catatan', 'Keterangan']),
  };

  const cell = (row, key) => (COL[key] && row[COL[key]] != null ? row[COL[key]] : undefined);

  // 1. Assign row_number to all rows based on original order
  const rowsWithRowNumber = parsed.data.map((row, index) => ({
    ...row,
    row_number: index + 2 // 1-based index + 1 for header row
  }));

  // 2. Explicitly sort by row_number to guarantee spreadsheet order
  rowsWithRowNumber.sort((a, b) => a.row_number - b.row_number);

  let current_time = '';
  let lastTerm = '';
  let lastTeacher = '';
  let lastBaseTeacher = '';

  rowsWithRowNumber.forEach((row) => {
    const rawStudent = cell(row, 'student');
    const rawTime = cell(row, 'time');
    const rawTerm = cell(row, 'term');

    if (!rawStudent && !rawTime && !rawTerm) return;
    if (rawTime === 'Time' || rawTerm === 'Term-Branch') return;

    // 3. Loop every row: if row.time is populated, update current_time, else inherit
    if (rawTime && rawTime.trim() !== '') {
      current_time = rawTime.trim();
    }
    let time = current_time;
    let term = rawTerm ? rawTerm.trim() : lastTerm;

    const rawColumnC = cell(row, 'instructor') ? cell(row, 'instructor').trim() : '';
    let baseTeacher = rawColumnC || lastBaseTeacher;
    let teacher = baseTeacher;

    if (baseTeacher) lastBaseTeacher = baseTeacher;

    const lessonArrange = cell(row, 'lessonArrange');
    if (lessonArrange && lessonArrange.includes(',')) {
      const parts = lessonArrange.split(',');
      const assignedInstructor = parts[parts.length - 1].trim();
      if (assignedInstructor && assignedInstructor !== '-') {
        teacher = assignedInstructor;
      }
    } else if (lessonArrange && lessonArrange.trim() && lessonArrange.trim() !== '-') {
      const v = lessonArrange.trim();
      const looksLikeLessonCode =
        /^[A-Z]+\d.*\.\d+$/i.test(v) ||
        /^(coder|trial|reg|k\d|kf\d|j\d|jf\d|cb\d|cd\d)/i.test(v);
      const looksLikeDateOrNote =
        /\d/.test(v) ||
        /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mei|agu|okt|des|izin|ijin|reschedule|pending|done|tba)/i.test(v);
      if (!looksLikeLessonCode && !looksLikeDateOrNote) {
        teacher = v;
      }
    } else if (!lessonArrange || lessonArrange.trim() === '') {
      if (!rawColumnC) {
        teacher = '';
      }
    }

    if (time && time.startsWith('010.')) time = time.substring(1);

    if (time) current_time = time;
    if (term) lastTerm = term;
    if (teacher) lastTeacher = teacher;

    if (rawStudent && teacher && teacher !== '-') {
      classes.push({
        day: dayName,
        time,
        term: term || '',
        teacher: teacher.trim(),
        student: rawStudent.trim(),
        remarks: cell(row, 'remarks') || '',
        branchId,
        branchName,
        row_number: row.row_number,
        rowNumber: row.row_number
      });
    }
  });

  return classes;
}

/**
 * Discovers day tabs and fetches all classes for a branch sheet
 */
async function fetchBranchClasses(branch) {
  let sheetUrl = branch.url;
  if (!sheetUrl) return [];

  sheetUrl = sheetUrl.trim();
  if (sheetUrl.includes('?')) sheetUrl = sheetUrl.split('?')[0];
  if (sheetUrl.includes('#')) sheetUrl = sheetUrl.split('#')[0];
  if (sheetUrl.endsWith('/pubhtml')) sheetUrl = sheetUrl.replace('/pubhtml', '/pub');
  if (sheetUrl.endsWith('/edit')) sheetUrl = sheetUrl.replace('/edit', '/pub');
  if (!sheetUrl.endsWith('/pub')) sheetUrl = sheetUrl + '/pub';

  try {
    const pubHtmlUrl = sheetUrl.replace('/pub', '/pubhtml');
    const tabsResponse = await fetch(pubHtmlUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      next: { revalidate: 60 } // Cache for 60 seconds
    });
    if (!tabsResponse.ok) return [];
    const html = await tabsResponse.text();

    const tabs = [];
    let match;
    const oldRegex = /<li[^>]*id="sheet-button-(\d+)"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/g;
    while ((match = oldRegex.exec(html)) !== null) {
      tabs.push({ gid: match[1], name: match[2].trim() });
    }
    if (tabs.length === 0) {
      const newRegex = /\{name:\s*"([^"]+)"[^}]+gid:\s*"(\d+)"/g;
      while ((match = newRegex.exec(html)) !== null) {
        tabs.push({ gid: match[2], name: match[1].trim() });
      }
    }

    const dayTabs = tabs.filter((tab) => {
      const lower = tab.name.toLowerCase();
      const matchedDay = DAY_NAMES.find((day) => lower.includes(day.toLowerCase()));
      if (matchedDay) {
        tab.normalizedDay = matchedDay;
        return true;
      }
      return false;
    });

    const branchClasses = [];
    const results = await Promise.allSettled(
      dayTabs.map(async (tab) => {
        const csvUrl = `${sheetUrl}?gid=${tab.gid}&single=true&output=csv`;
        const response = await fetch(csvUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'text/csv,text/plain,*/*',
          },
        });
        if (!response.ok) return null;
        const csvText = await response.text();
        return { tab, csvText };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        const { tab, csvText } = r.value;
        const parsed = parseCSVData(csvText, tab.normalizedDay || tab.name, branch.id, branch.name);
        branchClasses.push(...parsed);
      }
    }

    return branchClasses;
  } catch (err) {
    console.error(`Failed to fetch classes for branch ${branch.name}:`, err.message);
    return [];
  }
}

/**
 * GET /api/instructors
 * Query params:
 *  - key: string (optional API key auth)
 */
export async function GET(request) {
  try {
    // 1. Basic Authorization Check
    const authHeader = request.headers.get('authorization');
    const { searchParams } = new URL(request.url);
    const queryKey = searchParams.get('key');

    let isAuthorized = false;
    if (authHeader === `Bearer ${CHATBOT_KEY}` || authHeader === `Bearer ${CRM_KEY}`) {
      isAuthorized = true;
    }
    if (queryKey === CHATBOT_KEY || queryKey === CRM_KEY) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch Configurations & Profiles
    let config = { branches: DEFAULT_BRANCHES, leaveList: [], disabledInstructors: [] };
    if (isConfigured()) {
      config = await getAllConfig();
    }

    const branches = config.branches || DEFAULT_BRANCHES;
    const leaveList = config.leaveList || [];
    const disabledInstructors = new Set(config.disabledInstructors || []);

    const profiles = await fetchInstructorProfilesRest();

    // 3. Fetch schedules for all enabled branches in parallel
    const activeBranches = branches.filter(b => b.url);
    const branchSchedulesResults = await Promise.allSettled(
      activeBranches.map(branch => fetchBranchClasses(branch))
    );

    const allClasses = [];
    branchSchedulesResults.forEach(r => {
      if (r.status === 'fulfilled') {
        allClasses.push(...r.value);
      }
    });

    // 4. Extract all unique instructor names
    const instructorNames = new Set();

    // Add names from profiles
    profiles.forEach(p => {
      const name = p.fullname || p.nickname || p.id.split('@')[0];
      if (name) instructorNames.add(name);
    });

    // Add names from scheduled classes
    allClasses.forEach(c => {
      if (c.teacher) instructorNames.add(c.teacher);
    });

    // Get today's local date string (WIB, UTC+7)
    const todayStr = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Helper to normalise clean name comparison
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // 5. Compile information for each instructor
    const instructorsList = Array.from(instructorNames).map(name => {
      // Find matching profile
      const profile = profiles.find(p => 
        norm(p.fullname) === norm(name) || 
        norm(p.nickname) === norm(name) ||
        norm(p.id.split('@')[0]) === norm(name)
      );

      // Filter classes for this instructor
      const instructorClasses = allClasses.filter(c => 
        norm(c.teacher) === norm(name) || 
        (profile && (norm(c.teacher) === norm(profile.fullname) || norm(c.teacher) === norm(profile.nickname)))
      );

      // Determine primary branch placement
      let primaryBranch = 'Unknown';
      if (profile && profile.location) {
        primaryBranch = profile.location;
      } else {
        const branchCounts = {};
        instructorClasses.forEach(cls => {
          if (cls.branchName) {
            branchCounts[cls.branchName] = (branchCounts[cls.branchName] || 0) + 1;
          }
        });
        const sorted = Object.entries(branchCounts).sort((a, b) => b[1] - a[1]);
        if (sorted.length > 0) {
          primaryBranch = sorted[0][0];
        }
      }

      // Determine active status
      const isDisabled = disabledInstructors.has(name) || (profile && disabledInstructors.has(profile.fullname));
      const status = isDisabled ? 'disabled' : 'active';

      // Get leaves
      const instructorLeaves = leaveList.filter(l => 
        norm(l.name) === norm(name) ||
        (profile && (norm(l.name) === norm(profile.fullname) || norm(l.name) === norm(profile.nickname)))
      );

      // Check if on leave today
      const onLeaveToday = instructorLeaves.some(l => {
        if (l.startDate && l.endDate) {
          return todayStr >= l.startDate && todayStr <= l.endDate;
        }
        // Legacy leave check by day name
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const todayDayName = daysOfWeek[new Date(Date.now() + 7 * 60 * 60 * 1000).getDay()];
        return l.day === todayDayName;
      });

      return {
        name,
        email: profile?.email || null,
        nickname: profile?.nickname || null,
        fullname: profile?.fullname || null,
        specialization: profile?.specialization || null,
        primaryBranch,
        status,
        onLeaveToday,
        leaves: instructorLeaves.map(l => ({
          startDate: l.startDate || null,
          endDate: l.endDate || null,
          day: l.day || null,
          reason: l.reason || ''
        })),
        classCount: instructorClasses.length,
        schedule: instructorClasses.map(c => ({
          day: c.day,
          time: c.time,
          branch: c.branchName,
          student: c.student,
          term: c.term,
          remarks: c.remarks
        }))
      };
    });

    // Sort active instructors first, then by name
    instructorsList.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'active' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      success: true,
      count: instructorsList.length,
      instructors: instructorsList
    });

  } catch (error) {
    console.error('Instructors API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
