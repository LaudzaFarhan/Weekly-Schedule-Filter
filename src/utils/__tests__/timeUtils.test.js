import { describe, it, expect } from 'vitest';
import { formatNormalizedTimeSlot, parseTimeSlot } from '../timeUtils';

describe('timeUtils - formatNormalizedTimeSlot', () => {
  it('normalizes 1.00-2.30pm to 1.00 - 2.30 pm', () => {
    expect(formatNormalizedTimeSlot('1.00-2.30pm')).toBe('1.00 - 2.30 pm');
  });

  it('normalizes 3.00-4.30pm to 3.00 - 4.30 pm', () => {
    expect(formatNormalizedTimeSlot('3.00-4.30pm')).toBe('3.00 - 4.30 pm');
  });

  it('normalizes 4.30-6.00pm to 4.30 - 6.00 pm', () => {
    expect(formatNormalizedTimeSlot('4.30-6.00pm')).toBe('4.30 - 6.00 pm');
  });

  it('normalizes 2.30-4.00pm to 2.30 - 4.00 pm', () => {
    expect(formatNormalizedTimeSlot('2.30-4.00pm')).toBe('2.30 - 4.00 pm');
  });

  it('normalizes 4.00-5.30pm to 4.00 - 5.30 pm', () => {
    expect(formatNormalizedTimeSlot('4.00-5.30pm')).toBe('4.00 - 5.30 pm');
  });

  it('normalizes leading zero 010.00-11.30am to 10.00 - 11.30 am', () => {
    expect(formatNormalizedTimeSlot('010.00-11.30am')).toBe('10.00 - 11.30 am');
  });

  it('handles spaces and hyphens cleanly', () => {
    expect(formatNormalizedTimeSlot(' 1.00 - 2.30 pm ')).toBe('1.00 - 2.30 pm');
    expect(formatNormalizedTimeSlot('10.00-11.30am')).toBe('10.00 - 11.30 am');
  });

  it('parses minutes correctly for all sample time slots', () => {
    const p1 = parseTimeSlot('010.00-11.30am');
    expect(p1).not.toBeNull();
    expect(p1.start).toBe(600); // 10:00 AM
    expect(p1.end).toBe(690);   // 11:30 AM

    const p2 = parseTimeSlot('1.00-2.30pm');
    expect(p2).not.toBeNull();
    expect(p2.start).toBe(780); // 1:00 PM
    expect(p2.end).toBe(870);   // 2:30 PM

    const p3 = parseTimeSlot('4.30-6.00pm');
    expect(p3).not.toBeNull();
    expect(p3.start).toBe(990);  // 4:30 PM (16:30 = 990 mins)
    expect(p3.end).toBe(1080);   // 6:00 PM (18:00 = 1080 mins)
  });
});
