import { NextResponse } from 'next/server';
import { GET as getSchedule } from '../schedule/route';
import { getAllConfig, isConfigured } from '@/lib/googleSheets';
import { generateTrialSlots, doTimeSlotsOverlap } from '@/utils/timeUtils';
import { leaveAppliesToDay } from '@/utils/dateUtils';
import { DAY_NAMES } from '@/utils/constants';

function getLevenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function getScheduledClass(lead, overallClasses = []) {
  if (!lead || !lead.name) return null;
  
  const namesToMatch = [];
  const parentOfMatch = lead.name.match(/^([^(]+)\s+\(Parent of\s+([^)]+)\)/i) || lead.name.match(/^([^(]+)\s+Parent of\s+(.+)/i);
  if (parentOfMatch) {
    namesToMatch.push(parentOfMatch[2].trim()); // Child name
    namesToMatch.push(parentOfMatch[1].trim()); // Parent name
  } else {
    const parenMatch = lead.name.match(/^([^(]+)\s+\(([^)]+)\)/);
    if (parenMatch) {
      namesToMatch.push(parenMatch[1].trim());
      namesToMatch.push(parenMatch[2].trim());
    } else {
      namesToMatch.push(lead.name.trim());
    }
  }
  
  const cleanStr = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanTargets = namesToMatch
    .map(name => cleanStr(name))
    .filter(name => name.length >= 2);
  
  if (cleanTargets.length === 0) return null;
  
  const isMatch = (classStudent) => {
    if (!classStudent) return false;
    const classStudentClean = cleanStr(classStudent);
    if (!classStudentClean || classStudentClean.length < 2) return false;
    
    return cleanTargets.some(targetClean => {
      if (classStudentClean === targetClean) return true;
      if (targetClean.length >= 4 && classStudentClean.length >= 4) {
        if (classStudentClean.includes(targetClean) || targetClean.includes(classStudentClean)) {
          return true;
        }
      }
      if (targetClean.length >= 3 && classStudentClean.length >= 3) {
        if (getLevenshteinDistance(targetClean, classStudentClean) <= 1) {
          return true;
        }
      }
      return false;
    });
  };

  // 1. Same-branch first
  let found = overallClasses.find(c => {
    const sameBranch = lead.branch && c.branchName && lead.branch.trim().toLowerCase() === c.branchName.trim().toLowerCase();
    return sameBranch && isMatch(c.student);
  });
  
  // 2. Fallback
  if (!found && (!lead.branch || lead.branch.trim() === '')) {
    found = overallClasses.find(c => isMatch(c.student));
  }
  
  return found;
}

function parseFirestoreDoc(doc) {
  const fields = doc.fields || {};
  const id = doc.name ? doc.name.split('/').pop() : '';
  const obj = { id };
  for (const [key, val] of Object.entries(fields)) {
    if (val.stringValue !== undefined) obj[key] = val.stringValue;
    else if (val.timestampValue !== undefined) obj[key] = val.timestampValue;
    else if (val.integerValue !== undefined) obj[key] = parseInt(val.integerValue, 10);
    else if (val.doubleValue !== undefined) obj[key] = parseFloat(val.doubleValue);
    else if (val.booleanValue !== undefined) obj[key] = val.booleanValue;
  }
  return obj;
}

const EXPECTED_API_KEY = process.env.CRM_API_KEY || 'crm-secure-key-12345';
const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'weekly-schedule-chatbot';
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyAmeryoAv6Nisk7foNUPOAQ3WIfYUajyOQ';

async function logActivityRest(userEmail, action, meta = '') {
  try {
    const name = userEmail ? userEmail.split('@')[0] : 'Unknown';
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/activityLogs?key=${API_KEY}`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          user: { stringValue: name },
          email: { stringValue: userEmail || '' },
          action: { stringValue: action },
          meta: { stringValue: meta || '' },
          timestamp: { timestampValue: new Date().toISOString() }
        }
      })
    });
  } catch (err) {
    console.error('Failed to log activity via REST:', err);
  }
}


/**
 * POST /api/crm
 * Webhook endpoint for WhatsApp bots to insert leads into CRM.
 * Expects Authorization: Bearer <CRM_API_KEY>
 */
export async function POST(request) {
  console.log('CRM API Route POST Request Received!');
  try {
    // 1. Validate API Key
    const authHeader = request.headers.get('authorization');
    console.log('Auth Header received:', authHeader);
    console.log('Expected Key config:', EXPECTED_API_KEY);
    if (!authHeader || authHeader !== `Bearer ${EXPECTED_API_KEY}`) {
      console.log('Auth Mismatch: unauthorized!');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse request JSON body
    const body = await request.json();
    
    // Check if it's the WhatsApp formatted lead
    const isWhatsAppLead = body.parent_name || body.child_name || body.location;
    
     let name = body.name;
     let phone = body.phone || body.phone_number || body.wa_id || '';
     let message = body.message;
     let status = body.status;
     let notes = body.notes;
     let branch = body.branch || body.branchName || '';
     let trialDate = body.trialDate || body.trial_date || '';
 
     if (isWhatsAppLead) {
       const parentName = body.parent_name || '';
       const childName = body.child_name || '';
       const age = body.age || '';
       const program = body.program || '';
       const location = body.location || '';
       const instructor = body.instructor || '';
       const day = body.day || '';
       const date = body.date || '';
       const time = body.time || '';
 
       name = parentName ? `${parentName} (Parent of ${childName})` : childName;
       if (!phone) {
         phone = body.phone || body.phone_number || '08123456789'; // Fallback phone
       }
       
       message = `WhatsApp Lead Details:
 - Parent Name: ${parentName}
 - Child Name: ${childName} (Age: ${age})
 - Program: ${program}
 - Location: ${location}
 - Instructor: ${instructor}
 - Schedule: ${day}, ${date} @ ${time}`;
 
       branch = location;
       status = status || 'trial_booked'; // Set to trial_booked since a schedule is already assigned
       notes = notes || 'Inserted via WhatsApp chatbot final data';
       trialDate = date;
     }
 
     if (!name || !phone) {
       return NextResponse.json({ error: 'Missing required fields: name/child_name and phone/phone_number' }, { status: 400 });
     }
 
     // 3. Add to Firestore collection 'crmLeads' using standard REST API to bypass gRPC issues in server context
     const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/crmLeads?key=${API_KEY}`;
     const res = await fetch(url, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json'
       },
       body: JSON.stringify({
         fields: {
           name: { stringValue: name.trim() },
           phone: { stringValue: phone.trim() },
           message: { stringValue: message || '' },
           status: { stringValue: status || 'interest_trial' },
           notes: { stringValue: notes || '' },
           branch: { stringValue: branch || '' },
           trialDate: { stringValue: trialDate || '' },
           createdAt: { timestampValue: new Date().toISOString() },
           updatedAt: { timestampValue: new Date().toISOString() }
         }
       })
     });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Firestore REST API returned ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const docId = data.name.split('/').pop();

    // Log the activity to Firestore logs
    await logActivityRest('api-webhook@whatsapp.bot', 'added CRM lead (via Webhook)', `Added lead "${name}"`);

    return NextResponse.json({
      success: true,
      message: 'CRM lead successfully created',
      id: docId
    }, { status: 200 });

  } catch (error) {
    console.error('CRM Webhook Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/crm
 * Webhook endpoint to update an existing CRM lead (e.g. status, notes).
 * Expects Authorization: Bearer <CRM_API_KEY>
 */
export async function PATCH(request) {
  console.log('CRM API Route PATCH Request Received!');
  try {
    // 1. Validate API Key
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${EXPECTED_API_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse request JSON body
    const body = await request.json();
    const leadId = body.id || body.leadId || body.lead_id;

    if (!leadId) {
      return NextResponse.json({ error: 'Missing required field: id or leadId' }, { status: 400 });
    }

    // 3. Build fields and updateMask dynamically
    const fields = {};
    const updateMaskFieldPaths = [];

    // Fields we support updating
    const updateableFields = ['status', 'notes', 'message', 'name', 'phone', 'branch', 'trialDate'];
    for (const key of updateableFields) {
      let val = body[key];
      if (key === 'trialDate' && val === undefined) {
        val = body.trial_date;
      }
      if (val !== undefined) {
        fields[key] = { stringValue: String(val).trim() };
        updateMaskFieldPaths.push(`updateMask.fieldPaths=${key}`);
      }
    }

    if (updateMaskFieldPaths.length === 0) {
      return NextResponse.json({ error: 'No fields to update provided' }, { status: 400 });
    }

    // Always update updatedAt
    fields.updatedAt = { timestampValue: new Date().toISOString() };
    updateMaskFieldPaths.push('updateMask.fieldPaths=updatedAt');

    const updateMaskQuery = updateMaskFieldPaths.join('&');
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/crmLeads/${leadId}?${updateMaskQuery}&key=${API_KEY}`;

    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Firestore REST API returned ${res.status}: ${errText}`);
    }

    const updatedFieldsList = Object.keys(fields).filter(k => k !== 'updatedAt');
    const statusVal = body.status ? `status to "${body.status}"` : '';
    const otherVals = updatedFieldsList.filter(f => f !== 'status').join(', ');
    const changeDetail = [statusVal, otherVals ? `updated ${otherVals}` : ''].filter(Boolean).join(' and ');
    
    // Log the activity to Firestore logs
    await logActivityRest('api-webhook@whatsapp.bot', 'updated CRM lead (via Webhook)', `Lead ID: ${leadId}. ${changeDetail}`);

    return NextResponse.json({
      success: true,
      message: 'CRM lead successfully updated',
      id: leadId,
      updatedFields: updatedFieldsList
    }, { status: 200 });

  } catch (error) {
    console.error('CRM Update Webhook Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/crm
 * Returns CRM leads matched with schedule data, booked slots summary, and real-time trial slot availability.
 * Expects Authorization: Bearer <CRM_API_KEY>
 */
export async function GET(request) {
  try {
    // 1. Validate API Key
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${EXPECTED_API_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch CRM leads from Firestore via REST
    const leadsUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/crmLeads?pageSize=300&key=${API_KEY}`;
    const leadsRes = await fetch(leadsUrl);
    if (!leadsRes.ok) {
      const errText = await leadsRes.text();
      throw new Error(`Firestore REST API returned ${leadsRes.status}: ${errText}`);
    }
    const leadsData = await leadsRes.json();
    const rawLeads = (leadsData.documents || []).map(parseFirestoreDoc);

    // 3. Fetch Master Schedule
    const sheetUrl = process.env.NEXT_PUBLIC_DEFAULT_SHEET_URL;
    const mockRequest = new Request(`http://localhost/api/schedule?sheetUrl=${encodeURIComponent(sheetUrl)}`);
    const scheduleRes = await getSchedule(mockRequest);
    const scheduleData = await scheduleRes.json();
    if (!scheduleData.success) {
      throw new Error(scheduleData.error || 'Failed to fetch master schedule');
    }
    const { classes, baseTeachers } = scheduleData;

    // 4. Fetch App Configurations (Leaves, Disabled, Trial Priority)
    let config = { leaveList: [], disabledInstructors: [], trialPriority: {} };
    if (isConfigured()) {
      config = await getAllConfig();
    }
    const leaveList = config.leaveList || [];
    const disabledInstructors = new Set(config.disabledInstructors || []);
    const trialPriority = config.trialPriority || {};

    // 5. Match CRM leads with scheduled classes
    const matchedLeads = rawLeads.map(lead => {
      const matched = getScheduledClass(lead, classes);
      return {
        ...lead,
        scheduledClass: matched ? {
          day: matched.day,
          time: matched.time,
          teacher: matched.teacher,
          student: matched.student,
          program: matched.program,
          branchName: matched.branchName,
          date: matched.date || ''
        } : null
      };
    });

    // 6. Compute Booked Slots Summary
    let totalBooked = 0;
    const byBranch = {};
    const byDayAndTime = {};

    matchedLeads.forEach(lead => {
      if (lead.scheduledClass) {
        totalBooked++;
        const { branchName, day, time } = lead.scheduledClass;
        
        // Count by branch
        if (branchName) {
          byBranch[branchName] = (byBranch[branchName] || 0) + 1;
        }

        // Count by branch -> day -> time
        if (branchName && day && time) {
          if (!byDayAndTime[branchName]) byDayAndTime[branchName] = {};
          if (!byDayAndTime[branchName][day]) byDayAndTime[branchName][day] = {};
          byDayAndTime[branchName][day][time] = (byDayAndTime[branchName][day][time] || 0) + 1;
        }
      }
    });

    // 7. Compute REAL-TIME Availability
    // Group availability by branch -> day -> program
    // We check availability for all working days (Monday-Saturday)
    const availability = {};
    const programs = ['Trial Kinder', 'Trial Junior', 'Trial Coder'];
    const branches = ['Bintaro', 'Bekasi'];

    for (const branchName of branches) {
      availability[branchName] = {};
      const workingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      for (const day of workingDays) {
        availability[branchName][day] = {};
        const allSlots = generateTrialSlots(day);

        if (allSlots.length === 0) continue;

        // Determine teachers on leave for this day
        const onLeave = new Set();
        leaveList.forEach((l) => {
          if (leaveAppliesToDay(l, day)) onLeave.add(l.name);
        });

        for (const program of programs) {
          const prioritizedTeachers = trialPriority[program] || [];
          const freeSlots = [];

          for (const slotStr of allSlots) {
            const availableTeachers = [];

            for (const teacher of baseTeachers) {
              if (disabledInstructors.has(teacher)) continue;
              if (onLeave.has(teacher)) continue;

              // Priority filter
              if (prioritizedTeachers.length > 0 && !prioritizedTeachers.includes(teacher)) {
                continue;
              }

              // Check if teacher is busy in this slot
              const isBusy = classes.some(
                (c) =>
                  c.teacher === teacher &&
                  c.day === day &&
                  c.branchName &&
                  c.branchName.toLowerCase() === branchName.toLowerCase() &&
                  doTimeSlotsOverlap(c.time, slotStr)
              );

              if (!isBusy) {
                availableTeachers.push(teacher);
              }
            }

            if (availableTeachers.length > 0) {
              freeSlots.push({
                slot: slotStr,
                availableTeachers
              });
            }
          }

          if (freeSlots.length > 0) {
            availability[branchName][day][program] = freeSlots;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      leads: matchedLeads,
      bookedSummary: {
        totalBooked,
        byBranch,
        byDayAndTime
      },
      availability
    }, { status: 200 });

  } catch (error) {
    console.error('CRM GET API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

