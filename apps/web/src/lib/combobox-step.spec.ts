// Journeys 16/11 J14-2 / J14-3: ↓ ↑ in a product / client search walk the results (wrapping, disabled ones skipped);
// the focus never leaves the field, so a pick cannot drop it on the sheet container.
import { comboboxStep } from '@djaber/ui';
import { describe, expect, it } from 'vitest';

describe('comboboxStep', () => {
  it('↓ from nothing highlighted is the first result, ↑ the last; both wrap', () => {
    expect(comboboxStep(-1, 1, 4)).toBe(0);
    expect(comboboxStep(-1, -1, 4)).toBe(3);
    expect(comboboxStep(3, 1, 4)).toBe(0);
    expect(comboboxStep(0, -1, 4)).toBe(3);
    expect(comboboxStep(1, 1, 4)).toBe(2);
  });
  it('skips the refused results (a service on a purchase); nothing to highlight keeps the current one', () => {
    const refused = (i: number) => i === 1 || i === 2;
    expect(comboboxStep(0, 1, 4, refused)).toBe(3);
    expect(comboboxStep(3, -1, 4, refused)).toBe(0);
    expect(comboboxStep(-1, 1, 2, () => true)).toBe(-1);
    expect(comboboxStep(-1, 1, 0)).toBe(-1);
  });
});
