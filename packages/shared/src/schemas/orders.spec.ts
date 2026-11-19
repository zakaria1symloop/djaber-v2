// journey J05v-3: the CONFIRMATION cell (orders list, order page, orders export) — no call to make on a closed order.
import { describe, expect, it } from 'vitest';
import { confirmationShown, orderRemaining } from './orders';

describe('confirmationShown', () => {
  it('« À APPELER » only on a new order, « RAPPEL » only on an open one; call results always', () => {
    expect(confirmationShown({ status: 'new', confirmationStatus: 'pending' })).toBe(true);
    for (const status of ['cancelled', 'returned', 'delivered', 'shipped', 'preparing']) expect(confirmationShown({ status, confirmationStatus: 'pending' })).toBe(false);
    expect(confirmationShown({ status: 'confirmed', confirmationStatus: 'callback' })).toBe(true);
    for (const status of ['cancelled', 'returned', 'delivered']) expect(confirmationShown({ status, confirmationStatus: 'callback' })).toBe(false);
    for (const confirmationStatus of ['confirmed', 'no_answer', 'rejected', 'wrong_number']) expect(confirmationShown({ status: 'cancelled', confirmationStatus })).toBe(true);
  });
});

// journey J08v-4: one « reste à encaisser » for the order pages, the delivery list / CSV, the exports and the AI
describe('orderRemaining', () => {
  it('0 on a cancelled / returned order, the balance (never below 0) otherwise', () => {
    for (const status of ['cancelled', 'returned']) expect(orderRemaining({ status, total: 10_000, amountPaid: 0 })).toBe(0);
    expect(orderRemaining({ status: 'delivered', total: 10_250, amountPaid: 10_000 })).toBe(250);
    expect(orderRemaining({ status: 'shipped', total: 1_900, amountPaid: 0 })).toBe(1_900);
    expect(orderRemaining({ status: 'confirmed', total: 1_000, amountPaid: 1_200 })).toBe(0);
  });
});
