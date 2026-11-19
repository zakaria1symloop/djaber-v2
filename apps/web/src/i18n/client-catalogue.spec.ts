// full-test 15/11 PUBLIC-04: in the browser bundles the catalogue module of the `@djaber/shared` barrel is an empty
// stand-in (next.config.ts, src/i18n/client-catalogue-stub.ts). Client code reads texts with `useT()`; a screen that needs
// the whole catalogue imports `@djaber/shared/messages`. This test refuses a barrel import of a catalogue reader outside
// the server-only modules, where it would silently read nothing in the browser.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as real from '@djaber/shared/messages';
import { describe, expect, it } from 'vitest';
import * as stub from './client-catalogue-stub';

const SRC = resolve(__dirname, '..');
const UI = resolve(__dirname, '../../../../packages/ui/src');
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f) && !/\.(spec|stories)\.tsx?$/.test(f)) out.push(p);
  }
  return out;
};
/** Server-only modules (metadata, server components): the real catalogue is there. */
const SERVER_ONLY = ['lib/public-fetch.ts', 'lib/server-messages.tsx'];
// readers of the catalogue module (`getMessages`, …) and of stored-text helpers that read it (`textIn`, …)
const READERS = /\b(?:getMessages|MESSAGES|systemUnitText|textIn|legacyStoredText|renderStoredTextIn)\b/;

describe('client catalogue stand-in (PUBLIC-04)', () => {
  it('has the same exports as the real catalogue module', () => {
    const names = (m: object) => Object.keys(m).filter((k) => k !== 'default' && k !== '__esModule').sort();
    expect(names(stub)).toEqual(names(real));
  });

  it('no client module (web, packages/ui) reads the catalogue through the @djaber/shared barrel', () => {
    const offenders: string[] = [];
    for (const file of [...walk(SRC), ...walk(UI)]) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      if (SERVER_ONLY.includes(rel)) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/import\s+(?!type\s)\{([^}]*)\}\s*from\s*'@djaber\/shared'/g)) if (READERS.test(m[1]!.replace(/\btype\s+\w+/g, ''))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('server-only modules are not imported by client components', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf8');
      if (!/^\s*['"]use client['"]/.test(src)) continue;
      if (/import\s+(?!type\s)[^;]*from\s*'@\/lib\/(?:server-messages|public-fetch)'/.test(src)) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });
});
