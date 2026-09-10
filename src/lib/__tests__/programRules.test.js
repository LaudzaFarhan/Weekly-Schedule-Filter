import { describe, it, expect } from 'vitest';
import { parseProgram, normaliseCoderLevel, levelsForCategory, lessonsForCategory, meetingsForSubscription } from '../programRules';

describe('parseProgram', () => {
  it('correctly parses short codes', () => {
    expect(parseProgram('KF1')).toEqual(expect.objectContaining({
      code: 'KF1',
      family: 'Kinder Foundation',
      category: 'Kinder',
      lesson: null,
    }));
    expect(parseProgram('KF2.3')).toEqual(expect.objectContaining({
      code: 'KF2',
      family: 'Kinder Foundation',
      category: 'Kinder',
      lesson: '3',
    }));
    expect(parseProgram('K1')).toEqual(expect.objectContaining({
      code: 'K1',
      family: 'Kinder Core',
      category: 'Kinder',
    }));
    expect(parseProgram('JF1.2')).toEqual(expect.objectContaining({
      code: 'JF1',
      family: 'Junior Foundation',
      category: 'Junior',
      lesson: '2',
    }));
    expect(parseProgram('J2')).toEqual(expect.objectContaining({
      code: 'J2',
      family: 'Junior Core',
      category: 'Junior',
    }));
  });

  it('correctly parses full level names and Coder stages', () => {
    expect(parseProgram('Kinder Foundation')).toEqual(expect.objectContaining({
      family: 'Kinder Foundation',
      category: 'Kinder',
    }));
    expect(parseProgram('Kinder Core')).toEqual(expect.objectContaining({
      family: 'Kinder Core',
      category: 'Kinder',
    }));
    expect(parseProgram('Junior Foundation')).toEqual(expect.objectContaining({
      family: 'Junior Foundation',
      category: 'Junior',
    }));
    expect(parseProgram('Junior Core')).toEqual(expect.objectContaining({
      family: 'Junior Core',
      category: 'Junior',
    }));
    expect(parseProgram('Coder Advance')).toEqual(expect.objectContaining({
      family: 'Coder',
      category: 'Coder',
    }));
    expect(parseProgram('Coder Basic')).toEqual(expect.objectContaining({
      family: 'Coder',
      category: 'Coder',
    }));
    expect(parseProgram('Basic 1')).toEqual(expect.objectContaining({
      family: 'Coder',
      category: 'Coder',
    }));
    expect(parseProgram('Intermediate 2')).toEqual(expect.objectContaining({
      family: 'Coder',
      category: 'Coder',
    }));
    expect(parseProgram('Foundation 2')).toEqual(expect.objectContaining({
      family: 'Coder',
      category: 'Coder',
    }));
    expect(parseProgram('Foundation 1')).toEqual(expect.objectContaining({
      family: 'Coder',
      category: 'Coder',
    }));
  });

  it('handles empty or blank values cleanly', () => {
    expect(parseProgram('')).toEqual({
      raw: '',
      code: '',
      lesson: null,
      family: null,
      category: null,
      lessonKey: '',
    });
    expect(parseProgram(null)).toEqual({
      raw: '',
      code: '',
      lesson: null,
      family: null,
      category: null,
      lessonKey: '',
    });
  });
});

describe('normaliseCoderLevel', () => {
  it('normalises basic and numbered coder levels into separated levels', () => {
    expect(normaliseCoderLevel('Basic 1')).toBe('Basic 1');
    expect(normaliseCoderLevel('Basic 2')).toBe('Basic 2');
    expect(normaliseCoderLevel('Coder Basic 2')).toBe('Basic 2');
    expect(normaliseCoderLevel('Intermediate 1')).toBe('Intermediate 1');
    expect(normaliseCoderLevel('Intermediate 2')).toBe('Intermediate 2');
    expect(normaliseCoderLevel('Advance 1')).toBe('Advance 1');
    expect(normaliseCoderLevel('Advance 2')).toBe('Advance 2');
    expect(normaliseCoderLevel('Advance 3')).toBe('Advance 3');
    expect(normaliseCoderLevel('Coder Advance 2')).toBe('Advance 2');
    expect(normaliseCoderLevel('Foundation 1')).toBe('Foundation 1');
    expect(normaliseCoderLevel('Foundation 4')).toBe('Foundation 4');
    expect(normaliseCoderLevel('Coder Foundation 3')).toBe('Foundation 3');
    expect(normaliseCoderLevel('Coder Basic')).toBe('Basic 1');
    expect(normaliseCoderLevel('Junior Core')).toBe('Junior Core');
  });
});

describe('lessonsForCategory, levelsForCategory, and meetingsForSubscription', () => {
  it('returns appropriate lesson counts', () => {
    expect(lessonsForCategory('Kinder')).toBe(10);
    expect(lessonsForCategory('Junior')).toBe(10);
    expect(lessonsForCategory('Coder')).toBe(12);
  });

  it('returns valid levels for each category', () => {
    expect(levelsForCategory('Kinder')).toEqual(['KF1', 'KF2', 'K1', 'K2', 'K3', 'K4']);
    expect(levelsForCategory('Junior')).toEqual(['JF1', 'JF2', 'J1', 'J2', 'J3', 'J4']);
    expect(levelsForCategory('Coder')).toEqual([
      'Foundation 1',
      'Foundation 2',
      'Foundation 3',
      'Foundation 4',
      'Basic 1',
      'Basic 2',
      'Intermediate 1',
      'Intermediate 2',
      'Advance 1',
      'Advance 2',
      'Advance 3',
    ]);
  });

  it('calculates meetings for subscription packages correctly', () => {
    expect(meetingsForSubscription('1 Month', 'Coder')).toBe(4);
    expect(meetingsForSubscription('3 Months', 'Coder')).toBe(12);
    expect(meetingsForSubscription('6 Months', 'Coder')).toBe(24);
    expect(meetingsForSubscription('9 Months', 'Coder')).toBe(36);
    expect(meetingsForSubscription('1 Year', 'Coder')).toBe(48);
    expect(meetingsForSubscription('3 Months', 'Junior')).toBe(10);
  });
});

