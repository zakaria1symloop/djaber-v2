// full-test 15/11 HELP-13 / ONBOARDING-13 — keyboard of the custom radio groups (stars, preset / option cards).
import { radioKeyTarget, radioTabIndex } from '@djaber/ui';
import { describe, expect, it } from 'vitest';

describe('radio group keys', () => {
  it('arrows move with wrap-around, left / right follow the reading direction, Home / End jump', () => {
    expect(radioKeyTarget('ArrowRight', 0, 4)).toBe(1);
    expect(radioKeyTarget('ArrowRight', 3, 4)).toBe(0);
    expect(radioKeyTarget('ArrowLeft', 0, 4)).toBe(3);
    expect(radioKeyTarget('ArrowRight', 0, 4, true)).toBe(3);
    expect(radioKeyTarget('ArrowDown', 1, 4)).toBe(2);
    expect(radioKeyTarget('ArrowUp', 1, 4)).toBe(0);
    expect(radioKeyTarget('Home', 2, 4)).toBe(0);
    expect(radioKeyTarget('End', 0, 4)).toBe(3);
    expect(radioKeyTarget('a', 0, 4)).toBeNull();
  });
  it('one Tab stop: the checked radio, the first one when none is checked', () => {
    expect([0, 1, 2].map((i) => radioTabIndex(i, 1))).toEqual([-1, 0, -1]);
    expect([0, 1, 2].map((i) => radioTabIndex(i, -1))).toEqual([0, -1, -1]);
  });
});
