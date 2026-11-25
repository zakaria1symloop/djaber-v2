// owner 23/11 (« my voice notes are not well understood »): the speech model is poor at Algerian darija. An Arabic reading (or a
// language nobody speaks here) gets two more readings of the same audio, then the text model works out what was said.
import { sameReading, spokenHere, TranscriptionService, voiceFixLine } from './transcription.service';

describe('voice notes: darija is rebuilt from several readings', () => {
  it('reads the languages spoken here (names or codes); no language given is trusted', () => {
    for (const l of ['Arabic', 'arabic', 'ar', 'French', 'fr', 'English', 'en', null, undefined, '']) expect([l, spokenHere(l)]).toEqual([l, true]);
    for (const l of ['Azerbaijani', 'Turkish', 'Persian', 'es', 'Maltese']) expect([l, spokenHere(l)]).toEqual([l, false]);
  });

  it('keeps the last line of the repair answer; UNCLEAR, nothing or an essay give nothing', () => {
    expect(voiceFixLine('شحال السومة تاعو بالضبط؟')).toBe('شحال السومة تاعو بالضبط؟');
    expect(voiceFixLine('The readings converge on « حبيت نعرف ».\n\nحبيت نعرف بشحال تبيعو المنتجات')).toBe('حبيت نعرف بشحال تبيعو المنتجات');
    expect(voiceFixLine('« لا لا حبيت نعرف واش عندكم من produits »')).toBe('لا لا حبيت نعرف واش عندكم من produits');
    for (const t of ['UNCLEAR', 'unclear.', '', null, 'x'.repeat(401)]) expect(voiceFixLine(t)).toBeNull();
  });

  const service = (first: { text: string; language: string | null }, o: { darija?: string; french?: string; fix?: string | Error } = {}) => {
    const heard: { language?: string }[] = [];
    const gateway = {
      transcribe: jest.fn(async (req: { language?: string }) => {
        heard.push({ language: req.language });
        if (req.language === 'ar') return { text: o.darija ?? '', language: 'ar', durationSec: 3 };
        if (req.language === 'fr') return { text: o.french ?? '', language: 'fr', durationSec: 3 };
        return { ...first, durationSec: 3 };
      }),
      generate: jest.fn(async () => {
        if (o.fix instanceof Error) throw o.fix;
        return { text: o.fix ?? '', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, finishReason: 'stop' };
      }),
    };
    const routing = { call: jest.fn(async (_cap: string, fn: (m: { ref: unknown }, t: number) => Promise<unknown>) => ({ value: await fn({ ref: {} }, 1000), model: { id: 'm' }, usedFallback: false })) };
    const svc = Object.create(TranscriptionService.prototype) as TranscriptionService;
    Object.assign(svc, { routing, gateway, log: { warn: jest.fn() } });
    return { svc, heard, gateway };
  };

  it('an Arabic reading ⇒ two hinted readings + the repair: its sentence is the transcript', async () => {
    const { svc, heard, gateway } = service({ text: 'شحال السيارة تقع بالضبط', language: 'Arabic' }, { darija: 'شحال السيارة تاعو بالضبط؟', french: 'Ch7al le seyar', fix: 'شحال السومة تاعو بالضبط؟' });
    const r = await svc.transcribe(Buffer.from('x'), 'audio/mp4');
    expect(heard.map((h) => h.language).sort()).toEqual(['ar', 'fr', undefined].sort());
    expect(gateway.generate).toHaveBeenCalledTimes(1);
    expect((gateway.generate.mock.calls[0] as unknown as [{ purpose: string; messages: { content: string }[] }])[0]).toMatchObject({ purpose: 'voice_fix' });
    expect(r).toMatchObject({ text: 'شحال السومة تاعو بالضبط؟', language: 'ar' });
  });

  it('« Azerbaijani » ⇒ its gibberish is left out; the Arabic reading stands when the repair says UNCLEAR or fails', async () => {
    const unclear = service({ text: 'Uqulli dhu qaraqtumə', language: 'Azerbaijani' }, { darija: 'قولي واش كاين عندكم', french: 'dis-moi', fix: 'UNCLEAR' });
    expect(await unclear.svc.transcribe(Buffer.from('x'), 'audio/mp4')).toMatchObject({ text: 'قولي واش كاين عندكم', language: 'ar' });
    expect(String((unclear.gateway.generate.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0]!.content)).not.toContain('Uqulli');
    const down = service({ text: 'واش كاين', language: 'ar' }, { darija: 'واش كاين عندكم', french: 'wach kayen', fix: new Error('provider down') });
    expect(await down.svc.transcribe(Buffer.from('x'), 'audio/mp4')).toMatchObject({ text: 'واش كاين', language: 'ar' });
  });

  it('English speech is kept as heard: one call, no repair', async () => {
    const { svc, heard, gateway } = service({ text: 'hello, do you have dresses?', language: 'en' });
    expect((await svc.transcribe(Buffer.from('x'), 'audio/mp4')).text).toBe('hello, do you have dresses?');
    expect(heard).toHaveLength(1);
    expect(gateway.generate).not.toHaveBeenCalled();
  });

  // Houssem live 25/11 UX-097: 6 of 9 voice notes wrong — darija mixed with French heard as « French »
  it('plain French: the reading with the darija hint says the same words ⇒ kept as heard, no repair', async () => {
    const { svc, heard, gateway } = service({ text: 'Bonjour, vous avez des robes ?', language: 'French' }, { darija: 'بونجور فو زافي دي روب', french: 'bonjour vous avez des robes' });
    expect(await svc.transcribe(Buffer.from('x'), 'audio/mp4')).toMatchObject({ text: 'Bonjour, vous avez des robes ?', language: 'French' });
    expect(heard).toHaveLength(3);
    expect(gateway.generate).not.toHaveBeenCalled();
  });

  it('darija heard as French: the readings disagree ⇒ rebuilt with the shop\'s product names', async () => {
    const { svc, gateway } = service({ text: 'Brice, commande 1, Satan, dresse rouge.', language: 'French' }, { darija: 'بغيت نكوموندي واحد ساتان دراس روج', french: 'bghit ncommandi wa7ed satin dress rouge', fix: 'بغيت نكوموندي واحد Satin dress rouge' });
    const r = await svc.transcribe(Buffer.from('x'), 'audio/mp4', { productNames: ['Satin dress', 'Recette Sac en cuir'] });
    expect(r).toMatchObject({ text: 'بغيت نكوموندي واحد Satin dress rouge', language: 'ar' });
    const sent = String((gateway.generate.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0]!.content);
    expect(sent).toContain('Brice, commande 1');
    expect(sent).toContain('Satin dress');
    // the repair unavailable: the note stays as heard
    const down = service({ text: 'Les raisons, oran, oran.', language: 'fr' }, { darija: 'ليفريزون لوهران', french: 'livraison l Oran', fix: new Error('down') });
    expect(await down.svc.transcribe(Buffer.from('x'), 'audio/mp4')).toMatchObject({ text: 'Les raisons, oran, oran.', language: 'fr' });
    // rebuilt as a French sentence: the note is French
    const fr = service({ text: 'Les raisons, oran, oran.', language: 'fr' }, { darija: 'ليفريزون لوهران', french: 'livraison a Oran', fix: 'livraison à Oran ?' });
    expect(await fr.svc.transcribe(Buffer.from('x'), 'audio/mp4')).toMatchObject({ text: 'livraison à Oran ?', language: 'fr' });
  });

  it('sameReading: same words whatever the case, the accents and the punctuation', () => {
    expect(sameReading('Bonjour, vous avez des robes ?', 'bonjour vous avez des robes')).toBe(true);
    expect(sameReading('Combien coûte la livraison à Oran ?', 'combien coute la livraison a oran')).toBe(true);
    expect(sameReading('Les raisons, oran, oran.', 'livraison l Oran')).toBe(false);
    expect(sameReading('Brice, commande 1, Satan, dresse rouge.', 'bghit ncommandi wa7ed satin dress rouge')).toBe(false);
    expect(sameReading('', 'x')).toBe(false);
  });
});
