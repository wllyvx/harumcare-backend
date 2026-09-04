import { describe, it, expect } from 'vitest';
import { slugify, escapeLike, clampPageLimit } from '../src/modules/content/helpers.js';
import { ValidationError } from '../src/modules/content/errors.js';

describe('slugify', () => {
  it('lowercases', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });
  it('replaces [^a-z0-9]+ with -', () => {
    expect(slugify('Hello--World!!  Test')).toBe('hello-world-test');
    expect(slugify('Berita Terkini 2024!')).toBe('berita-terkini-2024');
    expect(slugify('a_b c')).toBe('a-b-c');
  });
  it('trims leading/trailing -', () => {
    expect(slugify('--hello--')).toBe('hello');
    expect(slugify('  --Hello__World--  ')).toBe('hello-world');
  });
  it('returns empty for non-string', () => {
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
  });
});

describe('escapeLike', () => {
  it('escapes % _ \\', () => {
    expect(escapeLike('100%_x')).toBe('100\\%\\_x');
    expect(escapeLike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
    expect(escapeLike('hello')).toBe('hello');
  });
  it('escapes all occurrences', () => {
    expect(escapeLike('%%%')).toBe('\\%\\%\\%');
    expect(escapeLike('___')).toBe('\\_\\_\\_');
  });
  it('returns empty for non-string', () => {
    expect(escapeLike(null)).toBe('');
  });
});

describe('clampPageLimit', () => {
  it('defaults page 1 limit 10', () => {
    expect(clampPageLimit({})).toEqual({ page: 1, limit: 10 });
    expect(clampPageLimit()).toEqual({ page: 1, limit: 10 });
  });
  it('clamps page 1..1000', () => {
    expect(clampPageLimit({ page: '0' }).page).toBe(1);
    expect(clampPageLimit({ page: '-5' }).page).toBe(1);
    expect(clampPageLimit({ page: '5000' }).page).toBe(1000);
    expect(clampPageLimit({ page: '500' }).page).toBe(500);
  });
  it('clamps limit 1..50', () => {
    expect(clampPageLimit({ limit: '0' }).limit).toBe(1);
    expect(clampPageLimit({ limit: '-1' }).limit).toBe(1);
    expect(clampPageLimit({ limit: '9999' }).limit).toBe(50);
    expect(clampPageLimit({ limit: '25' }).limit).toBe(25);
  });
  it('parses numeric strings', () => {
    expect(clampPageLimit({ page: '2', limit: '20' })).toEqual({ page: 2, limit: 20 });
  });
  it('throws ValidationError for non-numeric page/limit', () => {
    expect(() => clampPageLimit({ page: 'abc' })).toThrow(ValidationError);
    expect(() => clampPageLimit({ limit: 'abc' })).toThrow(ValidationError);
    expect(() => clampPageLimit({ page: 'NaN' })).toThrow(ValidationError);
    expect(() => clampPageLimit({ page: 'Infinity' })).toThrow(ValidationError);
    expect(() => clampPageLimit({ limit: 'Infinity' })).toThrow(ValidationError);
  });
  it('floors decimals', () => {
    expect(clampPageLimit({ page: '2.9', limit: '5.9' })).toEqual({ page: 2, limit: 5 });
  });
});
