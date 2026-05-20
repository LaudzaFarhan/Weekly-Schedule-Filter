/**
 * Parse a time string like "10.00 - 11.00 am" or "11.30 - 12.30 pm" into
 * start/end minutes from midnight.
 *
 * Handles the common ambiguity where the start has no AM/PM marker but the
 * end does. We try the end's AM/PM on the start first; if that produces an
 * invalid (end <= start) or absurdly long interval, we fall back to the
 * opposite meridiem so morning-into-noon classes parse correctly
 * (e.g. "11.00 - 12.00 pm" → 11am→12pm, not 11pm→12pm).
 */
export function parseTimeSlot(slotStr) {
  if (!slotStr || typeof slotStr !== 'string') return null;

  const cleaned = slotStr.replace(/\s+/g, ' ').trim();
  const dashIndex = cleaned.search(/[-–—]/);
  if (dashIndex === -1) return null;

  const startStr = cleaned.substring(0, dashIndex).trim();
  const endStr = cleaned.substring(dashIndex + 1).trim();

  const startHasAMPM = /am|pm/i.test(startStr);
  const endHasAMPM = /am|pm/i.test(endStr);
  const endAmpm = endHasAMPM ? (endStr.match(/am|pm/i)?.[0] || '').toLowerCase() : '';

  const endMinutes = parseTimeToMinutes(endStr);
  if (isNaN(endMinutes)) return null;

  let startMinutes;
  if (startHasAMPM) {
    startMinutes = parseTimeToMinutes(startStr);
  } else if (endHasAMPM) {
    // Try the same meridiem as the end first
    const sameAttempt = parseTimeToMinutes(`${startStr} ${endAmpm}`);
    // If that produces a valid forward interval shorter than 6h, accept it.
    if (sameAttempt < endMinutes && (endMinutes - sameAttempt) <= 6 * 60) {
      startMinutes = sameAttempt;
    } else {
      // Flip meridiem — most often this is the morning-into-noon case
      // (e.g. "11.00 - 12.00 pm" where start is actually AM).
      const flipped = endAmpm === 'pm' ? 'am' : 'pm';
      const flippedAttempt = parseTimeToMinutes(`${startStr} ${flipped}`);
      if (flippedAttempt < endMinutes && (endMinutes - flippedAttempt) <= 6 * 60) {
        startMinutes = flippedAttempt;
      } else {
        // Last resort: keep the original same-meridiem attempt
        startMinutes = sameAttempt;
      }
    }
  } else {
    // Neither side has AM/PM — treat as 24h
    startMinutes = parseTimeToMinutes(startStr);
  }

  if (isNaN(startMinutes)) return null;

  return { start: startMinutes, end: endMinutes, original: slotStr };
}

/**
 * Convert a time string like "10.30 am" to minutes from midnight.
 */
export function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  timeStr = timeStr.toLowerCase().trim();
  const isPM = timeStr.includes('pm');
  const isAM = timeStr.includes('am');

  timeStr = timeStr.replace(/am|pm/g, '').trim();
  let parts = timeStr.split(/[:.]/);
  let hours = parseInt(parts[0], 10) || 0;
  let minutes = parseInt(parts[1], 10) || 0;

  if (isPM && hours !== 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

/**
 * Check if two time slots overlap.
 */
export function doTimeSlotsOverlap(slot1, slot2) {
  if (slot1 === slot2) return true;

  const parsed1 = parseTimeSlot(slot1);
  const parsed2 = parseTimeSlot(slot2);

  if (!parsed1 || !parsed2) return slot1 === slot2;

  return parsed1.start < parsed2.end && parsed2.start < parsed1.end;
}

/**
 * Generate 1-hour trial slots for a given day (e.g. "Monday").
 */
export function generateTrialSlots(dayName) {
  if (!dayName || dayName === 'Sunday') return [];
  
  const isSaturday = dayName === 'Saturday';
  const startHour = isSaturday ? 10 : 11;
  
  const slots = [];
  for (let hour = startHour; hour <= 18; hour++) {
    for (let min of [0, 30]) {
      const formatTime = (h, m) => {
        const isPM = h >= 12;
        const displayH = h > 12 ? h - 12 : h;
        const ampm = isPM ? 'pm' : 'am';
        return `${displayH}.${m === 0 ? '00' : '30'} ${ampm}`;
      };
      
      const startStr = formatTime(hour, min);
      const endHour = hour + 1;
      const endStr = formatTime(endHour, min);
      
      const startIsPM = hour >= 12;
      const endIsPM = endHour >= 12;
      
      let slotString = '';
      if (startIsPM === endIsPM) {
        slotString = `${startStr.replace(/ am| pm/g, '')} - ${endStr}`;
      } else {
        slotString = `${startStr} - ${endStr}`;
      }
      slots.push(slotString);
    }
  }
  return slots;
}
