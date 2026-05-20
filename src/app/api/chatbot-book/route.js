import { NextResponse } from 'next/server';
import { GET as getSchedule } from '../schedule/route';
import { getAllConfig, isConfigured, appendRow } from '@/lib/googleSheets';
import { doTimeSlotsOverlap } from '@/utils/timeUtils';

const EXPECTED_API_KEY = process.env.CHATBOT_API_KEY || 'qontak-secure-key-12345';

const dayFormatMap = {
  'Monday': '1. Monday',
  'Tuesday': '2. Tuesday',
  'Wednesday': '3. Wednesday',
  'Thursday': '4. Thursday',
  'Friday': '5. Friday',
  'Saturday': '6. Saturday',
};

/**
 * POST /api/chatbot-book
 * Secure endpoint for the Qontak webhook to save a booking.
 */
export async function POST(request) {
  try {
    // 1. Validate API Key
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${EXPECTED_API_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. We need Google Service Account configured to write to sheets from the server safely.
    if (!isConfigured()) {
      return NextResponse.json({ 
        error: 'Backend is not configured for Google Sheets API. Please add GOOGLE_SERVICE_ACCOUNT credentials to Vercel.' 
      }, { status: 500 });
    }

    // 3. Parse JSON Body
    const body = await request.json();
    let { student, age, day, date, time, program, remarks } = body;

    if (!student || !day || !date || !time) {
      return NextResponse.json({ error: 'Missing required fields: student, day, date, time' }, { status: 400 });
    }

    // 4. Determine Program from Age if missing
    if (!program && age) {
      const ageNum = parseInt(age, 10);
      if (!isNaN(ageNum)) {
        if (ageNum >= 4 && ageNum <= 7) program = 'Trial Kinder';
        else if (ageNum >= 8 && ageNum <= 10) program = 'Trial Junior';
        else if (ageNum >= 11) program = 'Trial Coder';
      }
    }

    if (!program) {
      return NextResponse.json({ error: 'Could not determine program. Please provide age or program.' }, { status: 400 });
    }

    // 5. Find an Available Instructor — fetch all branch schedules
    const config = await getAllConfig();
    const branchList = config.branches || [{ id: 'default', name: 'Default', url: process.env.NEXT_PUBLIC_DEFAULT_SHEET_URL }];
    
    let allClasses = [];
    let allBaseTeachers = new Set();

    // Fetch schedules from all configured branches
    for (const branch of branchList) {
      if (!branch.url) continue;
      try {
        const branchRequest = new Request(`http://localhost/api/schedule?sheetUrl=${encodeURIComponent(branch.url)}&branchId=${encodeURIComponent(branch.id)}&branchName=${encodeURIComponent(branch.name)}`);
        const branchRes = await getSchedule(branchRequest);
        const branchData = await branchRes.json();
        if (branchData.success) {
          allClasses.push(...branchData.classes);
          branchData.baseTeachers.forEach(t => allBaseTeachers.add(t));
        }
      } catch (e) {
        console.warn(`Failed to fetch schedule for branch ${branch.name}:`, e.message);
      }
    }

    let assignedInstructor = 'Pending Allocation';

    if (allClasses.length > 0) {
      const leaveList = config.leaveList || [];
      const disabledInstructors = new Set(config.disabledInstructors || []);
      
      // trialPriority is stored as an array of objects: [{name, type, location, ...}]
      // Filter by program type to get prioritized teachers for this program
      const trialPriorityArray = config.trialPriority || [];
      const programTypeMap = {
        'Trial Kinder': ['kinder-junior', 'junior-coder'],
        'Trial Junior': ['kinder-junior', 'junior-coder'],
        'Trial Coder': ['junior-coder'],
      };
      const allowedTypes = programTypeMap[program] || [];
      const prioritizedTeachers = trialPriorityArray
        .filter(p => allowedTypes.includes(p.type))
        .map(p => p.name);

      const onLeave = new Set();
      leaveList.forEach((l) => { if (l.day === day) onLeave.add(l.name); });

      const availableInstructors = [];

      for (const teacher of allBaseTeachers) {
        if (disabledInstructors.has(teacher) || onLeave.has(teacher)) continue;
        if (prioritizedTeachers.length > 0 && !prioritizedTeachers.includes(teacher)) continue;

        const isBusy = allClasses.some(
          (c) => c.teacher === teacher && c.day === day && doTimeSlotsOverlap(c.time, time)
        );

        if (!isBusy) {
          availableInstructors.push(teacher);
        }
      }

      // Pick a random available instructor
      if (availableInstructors.length > 0) {
        assignedInstructor = availableInstructors[Math.floor(Math.random() * availableInstructors.length)];
      }
    }

    // 6. Append to Google Sheets directly
    const rowData = [
      'Trial Leads',                  // Col A
      program,                        // Col B
      student,                        // Col C
      assignedInstructor,             // Col D
      dayFormatMap[day] || day,       // Col E
      time,                           // Col F
      date,                           // Col G
      remarks || 'Via Chatbot'        // Col H
    ];

    // Using the native googleSheets.js API helper — tab name is "Summary All"
    await appendRow('Summary All', rowData);

    return NextResponse.json({
      success: true,
      message: 'Booking successfully saved',
      data: { student, program, instructor: assignedInstructor, day, date, time }
    });

  } catch (error) {
    console.error('Chatbot Booking Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
