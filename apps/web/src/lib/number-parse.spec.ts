// Full-test 15/11 ORDERS-01 / PRODUCTS-01 / DELIVERY-01 / STOCK-02 / SETTINGS-09 / SALES-CASH-07: the one reading of an integer field.
import { describe, expect, it } from 'vitest';
import { integerDraftAfter, integerFieldText, integerOf, parseIntegerInput as parse } from '../../../../packages/ui/src/number-parse';

const value = (raw: string, o: Parameters<typeof parse>[1] = {}) => {
  const r = parse(raw, o);
  return r.ok ? r.value : 'IGNORED';
};

describe('parseIntegerInput', () => {
  it('thousands separators, spaces and a pasted currency word', () => {
    for (const raw of ['2500', '2 500', '2 500', '2.500', '2,500', '2 500 DA', '2500 da', '2500دج']) expect(value(raw)).toBe('2500');
    expect(value('1.000.000')).toBe('1000000');
    expect(value('12 500,00 DA')).toBe('12500');
  });
  it('a decimal part is never glued to the integer (no ×10 / ×100)', () => {
    expect(parse('2500,00')).toEqual({ ok: true, value: '2500', fraction: ',00', caretDigits: 4 });
    expect(value('1999.5')).toBe('1999');
    expect(value('1.5')).toBe('1');
    expect(value('2,5')).toBe('2');
    expect(parse('1999.')).toMatchObject({ value: '1999', fraction: '.' });
    expect(parse('0,5')).toMatchObject({ value: '0', fraction: ',5' });
    // journey J05: a 3rd / 4th decimal digit never turns the comma into a thousands separator
    expect(parse('2500,005')).toMatchObject({ value: '2500', fraction: ',005' });
    expect(value('2500,0000')).toBe('2500');
    expect(value('12 500,999')).toBe('12500');
  });
  it('typing « 2.500 » key by key ends as 2500, not 2 or 25', () => {
    expect(value('2.')).toBe('2');
    expect(value('2.5')).toBe('2');
    expect(value('2.50')).toBe('2');
    expect(value('2.500')).toBe('2500');
  });
  it('a minus sign: refused (field unchanged) unless the field allows it', () => {
    expect(value('-100')).toBe('IGNORED');
    expect(value('-5')).toBe('IGNORED');
    expect(value('-100', { allowNegative: true })).toBe('-100');
    expect(value('-', { allowNegative: true })).toBe('-');
    expect(value('--5', { allowNegative: true })).toBe('IGNORED');
    expect(value('5-', { allowNegative: true })).toBe('IGNORED');
    expect(value('-12,5', { allowNegative: true })).toBe('-12');
  });
  it('letters, exponent and too many digits are refused instead of being cut', () => {
    expect(value('1e3')).toBe('IGNORED');
    expect(value('abc')).toBe('IGNORED');
    expect(value('99999999999')).toBe('IGNORED');
    expect(value('999999999')).toBe('999999999');
    expect(value('12345', { maxDigits: 4 })).toBe('IGNORED');
    expect(value('2.50.0')).toBe('IGNORED');
  });
  it('Arabic-Indic digits, leading zeros, empty', () => {
    expect(value('٢٥٠٠')).toBe('2500');
    expect(value('۱۲')).toBe('12');
    expect(value('007')).toBe('7');
    expect(value('')).toBe('');
    expect(value('   ')).toBe('');
  });
  it('caret: digits before it in the result', () => {
    expect(parse('12 345', { caret: 2 })).toMatchObject({ value: '12345', caretDigits: 2 });
    expect(parse('0012', { caret: 4 })).toMatchObject({ value: '12', caretDigits: 2 });
  });
  it('integerOf', () => {
    expect(integerOf('2500')).toBe(2500);
    expect(integerOf('-3')).toBe(-3);
    expect(integerOf('')).toBeNull();
    expect(integerOf('-')).toBeNull();
  });
  it('journey J05r-1: an emptied field stays empty while typing, even when the screen turns it into 0', () => {
    // a screen that keeps a number (« amountOf('') = 0 ») — the order-page money edit
    const screen = (v: string) => String(/^\d+$/.test(v) ? Number(v) : 0);
    const group = (d: string) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    let value = '600';
    let draft = { fraction: '', blank: false };
    const type = (raw: string) => {
      const r = parse(raw);
      if (!r.ok) return;
      draft = integerDraftAfter(r);
      value = screen(r.value);
    };
    const shown = () => integerFieldText(group(value), draft);
    type('60');
    type('6');
    type('');
    expect(value).toBe('0');
    expect(shown()).toBe('');
    type('5');
    type('50');
    type('500');
    expect(shown()).toBe('500');
    expect(value).toBe('500');
    expect(integerFieldText('1 100', integerDraftAfter({ value: '1100', fraction: ',0' }))).toBe('1 100,0');
  });
});
