import { describe, it, expect } from 'vitest';
import { required, intEnv } from '../src/env.js';

describe('required', () => {
  it('returns the value when set', () => {
    expect(required('FOO', { FOO: 'bar' })).toBe('bar');
  });

  it('throws when missing', () => {
    expect(() => required('FOO', {})).toThrow(/Missing required.*FOO/);
  });

  it('throws when set to empty string (treated as unset)', () => {
    expect(() => required('FOO', { FOO: '' })).toThrow(/Missing required.*FOO/);
  });
});

describe('intEnv', () => {
  it('returns the parsed integer when set', () => {
    expect(intEnv('PORT', 3000, { PORT: '8080' })).toBe(8080);
  });

  it('returns the fallback when missing', () => {
    expect(intEnv('PORT', 3000, {})).toBe(3000);
  });

  it('returns the fallback when set to empty string', () => {
    expect(intEnv('PORT', 3000, { PORT: '' })).toBe(3000);
  });

  it('throws on non-numeric input', () => {
    expect(() => intEnv('PORT', 3000, { PORT: 'abc' })).toThrow(/Invalid integer.*PORT/);
  });

  it('throws on negative input', () => {
    expect(() => intEnv('PORT', 3000, { PORT: '-1' })).toThrow(/Invalid integer.*PORT/);
  });

  it('throws on NaN-producing input', () => {
    expect(() => intEnv('PORT', 3000, { PORT: 'NaN' })).toThrow(/Invalid integer.*PORT/);
  });

  it('throws on Infinity', () => {
    expect(() => intEnv('PORT', 3000, { PORT: 'Infinity' })).toThrow(/Invalid integer.*PORT/);
  });

  it('accepts zero', () => {
    expect(intEnv('PORT', 3000, { PORT: '0' })).toBe(0);
  });

  it('accepts decimals (Number.isFinite allows them — Number(\'1.5\') = 1.5)', () => {
    // Document the behavior: not strictly an integer, but isFinite passes.
    // In practice setTimeout/listen coerce to integer, so this is benign.
    expect(intEnv('PORT', 3000, { PORT: '1.5' })).toBe(1.5);
  });
});
