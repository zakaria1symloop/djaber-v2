// journey J05v-3: the CONFIRMATION cell (orders list, order page, orders export) — no call to make on a closed order.
import { describe, expect, it } from 'vitest';
import { confirmationShown } from './orders';

describe('confirmationShown', () => {
  it('« À APPELER » only on a new order, « RAPPEL » only on an open one; call results always', () => {
    expect(confirmationShown({ status: 'new', confirmationStatus: 'pending' })).toBe(true);
    for (const status of ['cancelled', 'returned', 'delivered', 'shipped', 'preparing']) expect(confirmationShown({ status, confirmationStatus: 'pending' })).toBe(false);
    expect(confirmationShown({ status: 'confirmed', confirmationStatus: 'callback' })).toBe(true);
    for (const status of ['cancelled', 'returned', 'delivered']) expect(confirmationShown({ status, confirmationStatus: 'callback' })).toBe(false);
    for (const confirmationStatus of ['confirmed', 'no_answer', 'rejected', 'wrong_number']) expect(confirmationShown({ status: 'cancelled', confirmationStatus })).toBe(true);
  });
});
