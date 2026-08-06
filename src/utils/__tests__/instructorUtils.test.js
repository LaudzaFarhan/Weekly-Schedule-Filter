import { describe, it, expect } from 'vitest';
import { isSameTeacher, resolveCanonicalTeacherName } from '../instructorUtils';

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

describe('resolveCanonicalTeacherName', () => {
  const instructors = [
    { name: 'FAUZIYAH AMIRA ZAHRA' },
    { name: 'HELEN TERESIA' },
    { name: 'IQBAL YUNANTO' },
    { name: 'KRIANGSKY VAN TANNUWIJAYA' },
    { name: 'RAYHAN HUGO ABIOCTO' },
    { name: 'RISAFYA TABRINA AURELIA' },
  ];

  it('resolves raw first names or nicknames to canonical names', () => {
    expect(resolveCanonicalTeacherName('Ziyah', instructors)).toBe('FAUZIYAH AMIRA ZAHRA');
    expect(resolveCanonicalTeacherName('Fauziyah', instructors)).toBe('FAUZIYAH AMIRA ZAHRA');
    expect(resolveCanonicalTeacherName('Iqbal', instructors)).toBe('IQBAL YUNANTO');
    expect(resolveCanonicalTeacherName('Rayhan', instructors)).toBe('RAYHAN HUGO ABIOCTO');
    expect(resolveCanonicalTeacherName('Helen', instructors)).toBe('HELEN TERESIA');
  });

  it('returns TBD when rawName is empty or missing', () => {
    expect(resolveCanonicalTeacherName('', instructors)).toBe('TBD');
    expect(resolveCanonicalTeacherName(null, instructors)).toBe('TBD');
  });
});
