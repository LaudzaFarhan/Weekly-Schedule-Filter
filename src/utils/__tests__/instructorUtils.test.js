import { describe, it, expect } from 'vitest';
import { isSameTeacher, resolveCanonicalTeacherName, getRecommendedAliases } from '../instructorUtils';

describe('isSameTeacher', () => {
  it('matches exact case-insensitive names', () => {
    expect(isSameTeacher('Helen Teresia', 'HELEN TERESIA')).toBe(true);
    expect(isSameTeacher('Iqbal Yunanto', 'IQBAL YUNANTO')).toBe(true);
  });

  it('matches first names and nicknames to full canonical names', () => {
    expect(isSameTeacher('Helen', 'HELEN TERESIA')).toBe(true);
    expect(isSameTeacher('Ziyah', 'FAUZIYAH AMIRA ZAHRA')).toBe(true);
    expect(isSameTeacher('Fauziyah', 'FAUZIYAH AMIRA ZAHRA')).toBe(true);
    expect(isSameTeacher('Iqbal', 'IQBAL YUNANTO')).toBe(true);
    expect(isSameTeacher('Rayhan', 'RAYHAN HUGO ABIOCTO')).toBe(true);
    expect(isSameTeacher('Kriangsky', 'KRIANGSKY VAN TANNUWIJAYA')).toBe(true);
    expect(isSameTeacher('Risafya', 'RISAFYA TABRINA AURELIA')).toBe(true);
  });

  it('returns false for non-matching teacher names', () => {
    expect(isSameTeacher('Helen', 'FAUZIYAH AMIRA ZAHRA')).toBe(false);
    expect(isSameTeacher('Iqbal', 'HELEN TERESIA')).toBe(false);
  });
});

describe('resolveCanonicalTeacherName with Aliases & Verification', () => {
  const instructorsWithAliases = [
    {
      name: 'FAUZIYAH AMIRA ZAHRA',
      aliases: ['Ziyah', 'Amira', 'Teacher Z'],
      verifiedAliases: ['Ziyah', 'Amira'], // 'Teacher Z' is unverified
    },
    {
      name: 'SUPANDI WIJAYA',
      aliases: ['Pandi'],
      verifiedAliases: ['Pandi'],
    },
  ];

  it('resolves verified aliases to the canonical instructor alias display name', () => {
    expect(resolveCanonicalTeacherName('Ziyah', instructorsWithAliases)).toBe('Ziyah');
    expect(resolveCanonicalTeacherName('FAUZIYAH AMIRA ZAHRA', instructorsWithAliases)).toBe('Ziyah');
    expect(resolveCanonicalTeacherName('Pandi', instructorsWithAliases)).toBe('Pandi');
  });

  it('does NOT resolve unverified aliases to canonical name', () => {
    // 'Teacher Z' is unverified, so it returns raw name 'Teacher Z' rather than syncing to FAUZIYAH AMIRA ZAHRA
    expect(resolveCanonicalTeacherName('Teacher Z', instructorsWithAliases)).toBe('Teacher Z');
  });

  it('returns TBD when rawName is empty or missing', () => {
    expect(resolveCanonicalTeacherName('', instructorsWithAliases)).toBe('TBD');
    expect(resolveCanonicalTeacherName(null, instructorsWithAliases)).toBe('TBD');
  });
});

describe('getRecommendedAliases from Imported Schedule Data', () => {
  const importedScheduleTeachers = [
    'Ziyah',
    'Amira',
    'Kak Ziyah',
    'FAUZIYAH AMIRA ZAHRA',
    'Pandi',
    'Kak Pandi',
    'Helen Teresia',
    'Other Random Name'
  ];

  it('extracts matching unmapped imported teacher names as recommended aliases', () => {
    const currentAliases = ['Ziyah'];
    const recs = getRecommendedAliases('FAUZIYAH AMIRA ZAHRA', currentAliases, importedScheduleTeachers);

    // Should include 'Amira' and 'Kak Ziyah', excluding 'Ziyah' (already saved) and exact name 'FAUZIYAH AMIRA ZAHRA'
    expect(recs).toContain('Amira');
    expect(recs).toContain('Kak Ziyah');
    expect(recs).not.toContain('Ziyah');
    expect(recs).not.toContain('FAUZIYAH AMIRA ZAHRA');
    expect(recs).not.toContain('Pandi');
  });
});

