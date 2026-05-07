import { NextResponse } from 'next/server';
import { GET as getSchedule } from '../schedule/route';
import { getAllConfig, isConfigured } from '@/lib/googleSheets';
import { generateTrialSlots, doTimeSlotsOverlap } from '@/utils/timeUtils';

// Example: Bearer CHATBOT_SECURE_TOKEN_123
const EXPECTED_API_KEY = process.env.CHATBOT_API_KEY || 'test-qontak-key-123';

/**
 * GET /api/slots?day=Monday&program=Trial%20Kinder
 * Used by Qontak WhatsApp Chatbot to get available slots.
 */
export async function GET(request) {
  try {
    // 1. Basic API Key Auth (so public users don't spam the schedule API)
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${EXPECTED_API_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse Query Params
    const { searchParams } = new URL(request.url);
    const day = searchParams.get('day');
    let program = searchParams.get('program');
    const age = searchParams.get('age');

    // Automatically convert Age to Program if age is provided
    if (age && !program) {
      const ageNum = parseInt(age, 10);
      if (!isNaN(ageNum)) {
        if (ageNum >= 4 && ageNum <= 7) program = 'Trial Kinder';
        else if (ageNum >= 8 && ageNum <= 10) program = 'Trial Junior';
        else if (ageNum >= 11) program = 'Trial Coder';
      }
    }

    if (!day || !program) {
      return NextResponse.json(
        { error: 'Missing required parameters: day and either (program OR age)' },
        { status: 400 }
      );
    }

    // 3. Fetch Master Schedule
    const sheetUrl = process.env.NEXT_PUBLIC_DEFAULT_SHEET_URL;
    const mockRequest = new Request(`http://localhost/api/schedule?sheetUrl=${encodeURIComponent(sheetUrl)}`);
    const scheduleRes = await getSchedule(mockRequest);
    const scheduleData = await scheduleRes.json();

    if (!scheduleData.success) {
      throw new Error(scheduleData.error || 'Failed to fetch master schedule');
    }

    const { classes, baseTeachers } = scheduleData;

    // 4. Fetch App Configuration (Leaves, Disabled, Priority)
    let config = { leaveList: [], disabledInstructors: [], trialPriority: {} };
    if (isConfigured()) {
      config = await getAllConfig();
    }
    
    const leaveList = config.leaveList || [];
    const disabledInstructors = new Set(config.disabledInstructors || []);
    const trialPriority = config.trialPriority || {};

    // 5. Generate Base Trial Slots for the specified day
    const allSlots = generateTrialSlots(day);
    if (allSlots.length === 0) {
      return NextResponse.json({ slots: [], message: 'No slots available on this day.' });
    }

    // 6. Filter slots based on Instructor Availability
    const onLeave = new Set();
    leaveList.forEach((l) => {
      if (l.day === day) onLeave.add(l.name);
    });

    // Determine which teachers can teach this program (from Trial Priority settings)
    const prioritizedTeachers = trialPriority[program] || [];

    const availableSlots = [];

    for (const slotStr of allSlots) {
      let hasFreeInstructor = false;

      for (const teacher of baseTeachers) {
        if (disabledInstructors.has(teacher)) continue;
        if (onLeave.has(teacher)) continue;

        // If priority list exists for this program, teacher must be in it
        if (prioritizedTeachers.length > 0 && !prioritizedTeachers.includes(teacher)) {
          continue;
        }

        // Check if teacher is busy
        const isBusy = classes.some(
          (c) =>
            c.teacher === teacher &&
            c.day === day &&
            doTimeSlotsOverlap(c.time, slotStr)
        );

        if (!isBusy) {
          hasFreeInstructor = true;
          break; // We found at least one free teacher, so the slot is available
        }
      }

      if (hasFreeInstructor) {
        availableSlots.push(slotStr);
      }
    }

    return NextResponse.json({
      success: true,
      day,
      program,
      availableSlots
    });

  } catch (error) {
    console.error('Chatbot API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
