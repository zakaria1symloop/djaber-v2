// Tester live 26/11 10:08: « Alger, Bab Ezzouar » said in an Arabic conversation was heard as English (« Al Jai, that's the war. »)
// and kept as it was; the turn was unclear and the conversation became English.
import { TranscriptionService, voiceFixLine, voiceFixUncertain } from './transcription.service';

const service = (first: { text: string; language: string }, hinted: Record<string, string>, fix: string | null) => {
  const transcribe = jest.fn(async (req: { language?: string }) => (req.language ? { text: hinted[req.language] ?? '', language: req.language, durationSec: 3 } : { ...first, durationSec: 3 }));
  const generate = jest.fn(async () => ({ text: fix ?? 'UNCLEAR' }));
  const routing = { call: jest.fn(async (_route: string, fn: (m: { ref: string }, timeoutMs: number) => Promise<unknown>) => ({ value: await fn({ ref: 'm' }, 1000), model: 'm', usedFallback: false })) };
  const svc = new TranscriptionService({ transcribe, generate } as never, routing as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { svc, transcribe, generate };
};
const AUDIO = Buffer.from('x');

describe('a voice note heard as English', () => {
  it('in an English conversation (or with no language known yet) it is kept as heard: one reading, no repair', async () => {
    for (const conversationLanguage of ['en', null, undefined]) {
      const s = service({ text: 'Do you deliver to Oran?', language: 'english' }, {}, null);
      expect((await s.svc.transcribe(AUDIO, 'audio/mp4', { conversationLanguage })).text).toBe('Do you deliver to Oran?');
      expect(s.transcribe).toHaveBeenCalledTimes(1);
      expect(s.generate).not.toHaveBeenCalled();
    }
  });
  it('in an Arabic conversation it is read again with the darija hints and repaired with the place names', async () => {
    const s = service({ text: "Al Jai, that's the war.", language: 'english' }, { ar: 'الجي باب الزوار', fr: 'Alger, Bab Ezzouar' }, 'Alger، Bab Ezzouar');
    const r = await s.svc.transcribe(AUDIO, 'audio/mp4', { conversationLanguage: 'ar', placeNames: ['Alger', 'Oran', 'Bab Ezzouar'] });
    expect(r.text).toBe('Alger، Bab Ezzouar');
    expect(s.transcribe).toHaveBeenCalledTimes(3);
    const prompt = JSON.stringify((s.generate.mock.calls[0] as unknown[])[0]);
    expect(prompt).toContain('Bab Ezzouar');
    expect(prompt).toContain('Places of delivery');
  });
  // owner 26/11: « he has to tell the client "I didn't understand you", better than respond with something that doesn't meet the ask »
  it('readings that do not agree and a repair that cannot tell ⇒ the note is not understood (no guess is kept)', async () => {
    const s = service({ text: "Al Jai, that's the war.", language: 'english' }, { ar: 'الجيد بزور', fr: 'La j’ai, bas des ours' }, null);
    const r = await s.svc.transcribe(AUDIO, 'audio/mp4', { conversationLanguage: 'ar' });
    expect(r).toMatchObject({ unclear: true });
  });
  it('a repair that is unavailable keeps the best reading (a provider failure is not « not understood »)', async () => {
    const s = service({ text: 'واش كاين', language: 'arabic' }, { ar: 'واش كاين عندكم', fr: 'wach kayen' }, null);
    s.generate.mockRejectedValueOnce(new Error('provider down'));
    const r = await s.svc.transcribe(AUDIO, 'audio/mp4', { conversationLanguage: 'ar' });
    expect('unclear' in r && r.unclear).toBeFalsy();
    expect(r.text).toBeTruthy();
  });
  it('real English said twice the same way stays as heard', async () => {
    const s = service({ text: 'Do you deliver to Oran?', language: 'english' }, { ar: 'دو يو دليفر', fr: 'Do you deliver to Oran ?' }, null);
    expect((await s.svc.transcribe(AUDIO, 'audio/mp4', { conversationLanguage: 'ar' })).text).toBe('Do you deliver to Oran?');
    expect(s.generate).not.toHaveBeenCalled();
  });
});

// UX-106 (tester 26/11 10:41): notes said very fast were « understood » with a word he never said (« دابا »)
describe('an uncertain reading', () => {
  it('the repair line that starts with « ? » is uncertain; the mark is not part of the sentence', () => {
    expect(voiceFixUncertain('? livraison l Oran')).toBe(true);
    expect(voiceFixUncertain('؟ التوصيل لوهران')).toBe(true);
    expect(voiceFixLine('? livraison l Oran')).toBe('livraison l Oran');
    expect(voiceFixLine('« ? التوصيل لوهران »')).toBe('التوصيل لوهران');
    expect(voiceFixUncertain('livraison l Oran ch7al ?')).toBe(false);
    expect(voiceFixLine('livraison l Oran ch7al ?')).toBe('livraison l Oran ch7al ?');
  });
  it('transcribe carries the mark with the repaired text', async () => {
    const s = service({ text: 'ليفريزون وهران', language: 'arabic' }, { ar: 'التوصيل لوهران دابا', fr: 'livraison Oran' }, '? livraison l Oran');
    expect(await s.svc.transcribe(AUDIO, 'audio/mp4', { conversationLanguage: 'ar' })).toMatchObject({ text: 'livraison l Oran', uncertain: true });
    const sure = service({ text: 'ليفريزون وهران شحال', language: 'arabic' }, { ar: 'التوصيل لوهران شحال', fr: 'livraison Oran ch7al' }, 'التوصيل لـ Oran شحال؟');
    const r = await sure.svc.transcribe(AUDIO, 'audio/mp4', { conversationLanguage: 'ar' });
    expect(r.text).toBe('التوصيل لـ Oran شحال؟');
    expect('uncertain' in r && r.uncertain).toBeFalsy();
  });
});
