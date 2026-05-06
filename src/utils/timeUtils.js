/**
 * Parse a time string like "10.00 - 11.00 am" into start/end minutes from midnight.
 */
export function parseTimeSlot(slotStr) {
  if (!slotStr || typeof slotStr !== 'string') return null;

  const cleaned = slotStr.replace(/\s+/g, ' ').trim();
  const dashIndex = cleaned.search(/[-–—]/);
  if (dashIndex === -1) return null;

  const startStr = cleaned.substring(0, dashIndex).trim();
  let endStr = cleaned.substring(dashIndex + 1).trim();

  const endHasAMPM = /am|pm/i.test(endStr);
  const startHasAMPM = /am|pm/i.test(startStr);

  let ampm = '';
  if (endHasAMPM) {
    ampm = endStr.match(/am|pm/i)?.[0]?.toLowerCase() || '';
  }

  const startMinutes = parseTimeToMinutes(startHasAMPM ? startStr : startStr + ' ' + ampm);
  const endMinutes = parseTimeToMinutes(endStr);

  if (isNaN(startMinutes) || isNaN(endMinutes)) return null;

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
