import { describe, it, expect } from 'vitest';
import { classifyLead, getLeadFollowUps } from '../crmPerformance';

describe('CRM Lead Profiling & Follow-Up Journey', () => {
  describe('getLeadFollowUps', () => {
    it('returns empty array when lead or follow-ups are missing', () => {
      expect(getLeadFollowUps(null)).toEqual([]);
      expect(getLeadFollowUps({})).toEqual([]);
      expect(getLeadFollowUps({ followUps: null })).toEqual([]);
    });

    it('returns followUps array when already an array', () => {
      const followUps = [
        { id: '1', attempt: 1, performedBy: 'Kak Sky', channel: 'WhatsApp', notes: 'First contact' },
      ];
      expect(getLeadFollowUps({ followUps })).toEqual(followUps);
      expect(getLeadFollowUps({ follow_ups: followUps })).toEqual(followUps);
    });

    it('parses JSON string follow_ups', () => {
      const list = [
        { id: '1', attempt: 1, performedBy: 'Muhajir', channel: 'Phone Call', notes: 'Interested' },
        { id: '2', attempt: 2, performedBy: 'Admin', channel: 'WhatsApp', notes: 'Scheduled visit' },
      ];
      expect(getLeadFollowUps({ follow_ups: JSON.stringify(list) })).toEqual(list);
    });

    it('extracts follow-ups embedded in notes fallback [FollowUps: [...]]', () => {
      const list = [
        { attempt: 1, performedBy: 'Kak Sherlyn', channel: 'WhatsApp', notes: 'Roblox course discussion' },
      ];
      const lead = {
        notes: `Student: Kevin, Age: 9 [FollowUps: ${JSON.stringify(list)}]`,
      };
      expect(getLeadFollowUps(lead)).toEqual(list);
    });
  });

  describe('classifyLead with Profiling and Follow-Up', () => {
    it('tags a parent in profiling stage as needsFollowUp = true', () => {
      const lead = {
        name: 'Indah Permatasari',
        status: 'profiling',
        branch: 'Bekasi',
        notes: 'Student: Kevin, Age: 9, Grade: 4th Grade, Parent: Ibu Indah',
      };

      const result = classifyLead(lead);
      expect(result.isProfiled).toBe(true);
      expect(result.isScheduled).toBe(false);
      expect(result.needsFollowUp).toBe(true);
      expect(result.followUpCount).toBe(0);
      expect(result.lastFollowUp).toBeNull();
    });

    it('marks needsFollowUp = false when trial is booked or scheduled', () => {
      const lead = {
        name: 'Indah Permatasari',
        status: 'trial_booked',
        trialDate: '2026-07-25',
        notes: 'Student: Kevin, Age: 9, Parent: Ibu Indah',
      };

      const result = classifyLead(lead);
      expect(result.isProfiled).toBe(true);
      expect(result.isScheduled).toBe(true);
      expect(result.needsFollowUp).toBe(false);
    });

    it('marks needsFollowUp = false when lead is junk or spam', () => {
      const lead = {
        name: 'Spam WhatsApp Bot',
        status: 'junk',
        notes: '[junk] test lead',
      };

      const result = classifyLead(lead);
      expect(result.isJunk).toBe(true);
      expect(result.needsFollowUp).toBe(false);
    });

    it('tracks journey who followed up and how many times', () => {
      const lead = {
        name: 'Ibu Ratna (Parent of Kevin)',
        status: 'profiling',
        notes: 'Kelas 4 SD',
        followUps: [
          { attempt: 1, performedBy: 'Kak Muhajir', channel: 'WhatsApp', date: '2026-08-01T10:00:00Z', notes: 'Sent brochure' },
          { attempt: 2, performedBy: 'Kak Sherlyn', channel: 'Phone Call', date: '2026-08-03T14:30:00Z', notes: 'Parent asked about schedule' },
        ],
      };

      const result = classifyLead(lead);
      expect(result.isProfiled).toBe(true);
      expect(result.needsFollowUp).toBe(true);
      expect(result.followUpCount).toBe(2);
      expect(result.lastFollowUp).toEqual({
        attempt: 2,
        performedBy: 'Kak Sherlyn',
        channel: 'Phone Call',
        date: '2026-08-03T14:30:00Z',
        notes: 'Parent asked about schedule',
      });
    });

    it('recognizes explicit [need follow up] tag in notes', () => {
      const lead = {
        name: 'Budi Santoso',
        status: 'interest_trial',
        notes: '[need follow up] wants to confirm schedule next week',
      };

      const result = classifyLead(lead);
      expect(result.needsFollowUp).toBe(true);
    });
  });
});
