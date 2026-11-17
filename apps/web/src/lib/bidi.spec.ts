// Journey 16/11 J03-7 / full-test 15/11 AI-CHAT-18: the left-to-right islands of a chat bubble (packages/ui `isolateNumbers`).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isolateNumbers } from '../../../../packages/ui/src/bidi';

// the unit tests compile JSX with the classic runtime (node environment)
(globalThis as { React?: unknown }).React = React;
const html = (text: string) => renderToStaticMarkup(React.createElement(React.Fragment, null, isolateNumbers(text)));

describe('isolateNumbers', () => {
  it('an Arabic sentence: a bracketed Latin word stays one island with its brackets (J03-7)', () => {
    expect(html('التوصيل لنقطة الاستلام (stop-desk) لوهران بـ 400 دج')).toBe('التوصيل لنقطة الاستلام <bdi dir="ltr">(stop-desk)</bdi> لوهران بـ <bdi dir="ltr">400</bdi> دج');
    expect(html('نبعثوها مع ZR Express بـ 4 900 دج')).toBe('نبعثوها مع <bdi dir="ltr">ZR Express</bdi> بـ <bdi dir="ltr">4 900</bdi> دج');
  });
  it('a French sentence: only the number groups (AI-CHAT-18); no group ⇒ unchanged', () => {
    expect(html('La robe est à 4 900 DA (stop-desk)')).toBe('La robe est à <bdi dir="ltr">4 900</bdi> DA (stop-desk)');
    expect(html('Bonjour, la robe est disponible.')).toBe('Bonjour, la robe est disponible.');
    expect(html('شكرا على ثقتك')).toBe('شكرا على ثقتك');
  });
});
