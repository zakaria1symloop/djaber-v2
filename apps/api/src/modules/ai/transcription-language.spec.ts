// owner 23/11 (« voice didn't work »): a short darija voice note came back as « Azerbaijani » gibberish — a guess outside the
// languages spoken here is transcribed again as Arabic.
import { spokenHere, TranscriptionService } from './transcription.service';

describe('voice notes: a wrong language guess is transcribed again as Arabic', () => {
  it('reads the languages spoken here (names or codes); no language given is trusted', () => {
    for (const l of ['Arabic', 'arabic', 'ar', 'French', 'fr', 'English', 'en', null, undefined, '']) expect([l, spokenHere(l)]).toEqual([l, true]);
    for (const l of ['Azerbaijani', 'Turkish', 'Persian', 'es', 'Maltese']) expect([l, spokenHere(l)]).toEqual([l, false]);
  });

  const service = (answers: { text: string; language: string | null }[]) => {
    const calls: { language?: string }[] = [];
    const gateway = { transcribe: jest.fn(async (req: { language?: string }) => (calls.push({ language: req.language }), { ...answers[calls.length - 1]!, durationSec: 3 })) };
    const routing = { call: jest.fn(async (_cap: string, fn: (m: { ref: unknown }, t: number) => Promise<unknown>) => ({ value: await fn({ ref: {} }, 1000), model: { id: 'm' }, usedFallback: false })) };
    const svc = Object.create(TranscriptionService.prototype) as TranscriptionService;
    Object.assign(svc, { routing, gateway });
    return { svc, calls };
  };

  it('« Azerbaijani » ⇒ a second call with language ar, its text is the transcript', async () => {
    const { svc, calls } = service([{ text: 'Uqulli dhu qaraqtumə', language: 'Azerbaijani' }, { text: 'قولي واش كاين عندكم', language: 'ar' }]);
    const r = await svc.transcribe(Buffer.from('x'), 'audio/mp4');
    expect(calls).toEqual([{ language: undefined }, { language: 'ar' }]);
    expect(r).toMatchObject({ text: 'قولي واش كاين عندكم', language: 'ar' });
  });

  it('Arabic / French guesses are kept: one call', async () => {
    for (const language of ['Arabic', 'French']) {
      const { svc, calls } = service([{ text: 'bonjour', language }]);
      expect((await svc.transcribe(Buffer.from('x'), 'audio/mp4')).text).toBe('bonjour');
      expect(calls).toHaveLength(1);
    }
  });
});
