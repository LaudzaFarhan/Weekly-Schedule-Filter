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
      return DAY_NAMES.some((day) => lower.includes(day.toLowerCase()));
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
        const parsed = parseCSVData(csvText, tab.name);
        allClasses.push(...parsed.classes);
        parsed.teachers.forEach((t) => teachers.add(t));
        parsed.baseTeachers.forEach((t) => baseTeachers.add(t));
        if (!times[tab.name]) times[tab.name] = [];
        parsed.times.forEach((t) => {
          if (!times[tab.name].includes(t)) times[tab.name].push(t);
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
function parseCSVData(csvText, dayName) {
  const classes = [];
  const teachers = new Set();
  const baseTeachers = new Set();
  const times = new Set();

  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  let lastTime = '';
  let lastTerm = '';
  let lastTeacher = '';
  let lastBaseTeacher = '';

  parsed.data.forEach((row) => {
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
    if (lessonArrange && lessonArrange.includes(',')) {
      const parts = lessonArrange.split(',');
      const assignedInstructor = parts[parts.length - 1].trim();
      if (assignedInstructor && assignedInstructor !== '-') {
        teacher = assignedInstructor;
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

    const student = row['Student Name'] ? row['Student Name'].trim() : '';

    if (student && teacher && time) {
      classes.push({
        day: dayName,
        time,
        program: term,
        teacher,
        student,
        remarks: row['Remarks'] || '',
        fullProgram: row['Program'] || '',
      });

      if (teacher !== '-') teachers.add(teacher);
      times.add(time);
    }
  });

  return { classes, teachers: [...teachers], baseTeachers: [...baseTeachers], times: [...times] };
}
