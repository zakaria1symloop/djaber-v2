// UX-015 (tester report 2026-10-21): « Bloquer le client » / « Débloquer le client » in the client `Actions ⌄` — the
// server already sent the descriptors, the menu had no handler for them and dropped them.
import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from '@/lib/i18n';
import { clientMenuActions, type ClientHandlers } from './client-actions';

const t = Object.assign((k: string) => k, { has: () => true }) as unknown as TFunction;
const noop = () => undefined;
const handlers = (o: Partial<ClientHandlers> = {}): ClientHandlers => ({ open: noop, edit: noop, complete: noop, merge: noop, newOrder: noop, orders: noop, tags: noop, export: noop, risk: noop, delete: noop, ...o });
const perms = { write: true, remove: true, orders: true, ordersWrite: true, inbox: true };
const row = (actions: { key: string; enabled: boolean; reasonCode?: string }[]) => ({ actions, riskLevel: 'normal' as const, isPlaceholder: false, orderCount: 0, name: 'Amine' });

describe('client menu — block / unblock', () => {
  it('« Bloquer le client » from the server descriptor, destructive, runs its handler', () => {
    const block = vi.fn();
    const items = clientMenuActions(row([{ key: 'block', enabled: true }]) as never, handlers({ block }), perms, t);
    const item = items.find((a) => a.key === 'block')!;
    expect(item).toMatchObject({ label: 'clients.action.block', destructive: true });
    item.onSelect?.();
    expect(block).toHaveBeenCalled();
  });
  it('« Débloquer » greyed with its reason when the member may not (safety.manage)', () => {
    const items = clientMenuActions(row([{ key: 'unblock', enabled: false, reasonCode: 'FORBIDDEN' }]) as never, handlers({ unblock: noop }), perms, t);
    expect(items.find((a) => a.key === 'unblock')).toMatchObject({ onSelect: undefined, disabledReason: expect.any(String) });
  });
  it('no descriptor or no handler ⇒ no item', () => {
    expect(clientMenuActions(row([]) as never, handlers({ block: noop }), perms, t).some((a) => a.key === 'block')).toBe(false);
    expect(clientMenuActions(row([{ key: 'block', enabled: true }]) as never, handlers(), perms, t).some((a) => a.key === 'block')).toBe(false);
  });
});

describe('client menu — archive / restore (full-test CLIENTS-02 / CLIENTS-03)', () => {
  it('a client with orders (server `archive`) offers « Archiver le client », not « Supprimer (soft) »', () => {
    const items = clientMenuActions(row([{ key: 'archive', enabled: true }]) as never, handlers(), perms, t);
    expect(items.find((a) => a.key === 'archive')).toMatchObject({ label: 'clients.action.archive', destructive: true });
    expect(items.some((a) => a.key === 'delete')).toBe(false);
  });
  it('an archived card offers its sheet and « Restaurer » only', () => {
    const restore = vi.fn();
    const items = clientMenuActions({ ...row([{ key: 'open', enabled: true }, { key: 'restore', enabled: true }]), archived: true } as never, handlers({ restore }), perms, t);
    expect(items.map((a) => a.key)).toEqual(['open', 'restore']);
    items.find((a) => a.key === 'restore')!.onSelect?.();
    expect(restore).toHaveBeenCalled();
  });
});
