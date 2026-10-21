// "Retour" of a detail page opened from another screen (tester report 2026-10-19: a sale opened from the cash register
// went back to the sales list) and the download helpers of signed files (UX-006, exports saved at once).
import { describe, expect, it } from 'vitest';
import { backLabelKey, safeBack, withBack } from './back';
import { fileNameOf, jobFileName, withDownloadName } from './jobs';

describe('back links', () => {
  it('keeps internal paths only', () => {
    expect(safeBack('/cash?day=2026-10-19')).toBe('/cash?day=2026-10-19');
    expect(safeBack('//evil.example/x')).toBeNull();
    expect(safeBack('/\\evil.example')).toBeNull();
    expect(safeBack('https://evil.example')).toBeNull();
    expect(safeBack('')).toBeNull();
    expect(safeBack(null)).toBeNull();
  });
  it('adds the screen to return to, filters included', () => {
    expect(withBack('/sales/s1', '/cash?day=2026-10-19&q=VNT')).toBe('/sales/s1?back=%2Fcash%3Fday%3D2026-10-19%26q%3DVNT');
    expect(withBack('/suppliers?sheet=x', '/reports/cash_register')).toBe('/suppliers?sheet=x&back=%2Freports%2Fcash_register');
  });
  it('names the back link after the screen', () => {
    expect(backLabelKey('/cash?day=2026-10-19')).toBe('nav.cash');
    expect(backLabelKey('/reports/cash_register?q=%23VNT-1005')).toBe('nav.reports');
    expect(backLabelKey('/unknown')).toBeNull();
  });
});

describe('signed file downloads', () => {
  it('asks the API for an attachment on its own file links only', () => {
    expect(withDownloadName('https://api.example/api/v1/files/private/ws/1/exports/j.xlsx?exp=1&sig=s', 'caisse.xlsx')).toBe('https://api.example/api/v1/files/private/ws/1/exports/j.xlsx?exp=1&sig=s&dl=caisse.xlsx');
    expect(withDownloadName('https://cdn.example/a.pdf', 'a.pdf')).toBe('https://cdn.example/a.pdf');
  });
  it('names the file after the job result, else after the link', () => {
    expect(jobFileName({ result: { fileName: 'ventes-2026-10.csv' } })).toBe('ventes-2026-10.csv');
    expect(jobFileName({ result: null })).toBeUndefined();
    expect(fileNameOf('https://api.example/api/v1/files/private/ws/1/prints/VNT-1005-1.pdf?exp=1&sig=s')).toBe('VNT-1005-1.pdf');
  });
});
