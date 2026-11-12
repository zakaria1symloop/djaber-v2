// 05-integrations §1.3 — webhook item → normalised event (the shapes the live app receives from Meta).
import { inboundExternalId, parseInbound, previewOf, type StoredInbound } from './inbound-parser';
import { MetaWebhookService } from './meta-webhook.service';
import { containsBlockedWord } from './safety.service';

const PAGE = '104455667788990';
const PSID = '6789012345678901';
const wrap = (item: Record<string, unknown>, object: 'page' | 'instagram' = 'page'): StoredInbound => ({ object, entryId: PAGE, time: 1760184000000, item: { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: 1760184000123, ...item } });

describe('parseInbound', () => {
  it('text message', () => {
    const p = parseInbound(wrap({ message: { mid: 'm_1', text: 'Salam, prix ?' } }));
    expect(p).toMatchObject({ kind: 'message', platform: 'facebook', channelExternalId: PAGE, customerId: PSID, mid: 'm_1', text: 'Salam, prix ?', type: 'text', attachments: [], payload: null, unsupportedOnly: false });
    expect((p as { at: Date }).at.toISOString()).toBe(new Date(1760184000123).toISOString());
  });

  it.each([
    ['image', 'image', false],
    ['audio', 'audio', false],
    ['video', 'video', true],
    ['file', 'file', true],
  ])('%s attachment', (metaType, type, unsupportedOnly) => {
    const p = parseInbound(wrap({ message: { mid: 'm_2', attachments: [{ type: metaType, payload: { url: `https://scontent.xx.fbcdn.net/${metaType}` } }] } }));
    expect(p).toMatchObject({ kind: 'message', type, text: null, unsupportedOnly, attachments: [{ type, url: `https://scontent.xx.fbcdn.net/${metaType}` }] });
  });

  it('a caption makes a media message readable; several attachments keep their order', () => {
    const p = parseInbound(wrap({ message: { mid: 'm_3', text: 'celui-ci', attachments: [{ type: 'video', payload: { url: 'https://v' } }, { type: 'image', payload: { url: 'https://i' } }] } }));
    expect(p).toMatchObject({ type: 'video', text: 'celui-ci', unsupportedOnly: false });
    expect((p as { attachments: { type: string }[] }).attachments.map((a) => a.type)).toEqual(['video', 'image']);
  });

  it('location, sticker, quick reply, story reply / mention', () => {
    expect(parseInbound(wrap({ message: { mid: 'm_4', attachments: [{ type: 'location', payload: { coordinates: { lat: 36.75, long: 3.05 } } }] } }))).toMatchObject({
      type: 'location',
      unsupportedOnly: true,
      attachments: [{ type: 'location', lat: 36.75, lng: 3.05, url: 'https://www.google.com/maps?q=36.75,3.05' }],
      payload: { location: { lat: 36.75, lng: 3.05 } },
    });
    expect(parseInbound(wrap({ message: { mid: 'm_5', sticker_id: 369239263222822, attachments: [{ type: 'image', payload: { url: 'https://s', sticker_id: 369239263222822 } }] } }))).toMatchObject({ type: 'sticker', unsupportedOnly: true });
    expect(parseInbound(wrap({ message: { mid: 'm_5b', sticker_id: 1 } }))).toMatchObject({ type: 'sticker', attachments: [{ type: 'sticker', url: null }] });
    expect(parseInbound(wrap({ message: { mid: 'm_6', text: 'Oui', quick_reply: { payload: 'YES' } } }))).toMatchObject({ type: 'text', payload: { quickReply: 'YES' } });
    expect(parseInbound(wrap({ message: { mid: 'm_7', text: 'dispo ?', reply_to: { story: { url: 'https://story', id: '1' } } } }, 'instagram'))).toMatchObject({ platform: 'instagram', type: 'text', payload: { story: { kind: 'reply', url: 'https://story' } } });
    expect(parseInbound(wrap({ message: { mid: 'm_8', attachments: [{ type: 'story_mention', payload: { url: 'https://mention' } }] } }, 'instagram'))).toMatchObject({ type: 'image', payload: { story: { kind: 'mention', url: 'https://mention' } } });
  });

  it('unsupported content, shared links, deleted messages', () => {
    expect(parseInbound(wrap({ message: { mid: 'm_9', is_unsupported: true } }, 'instagram'))).toMatchObject({ kind: 'message', type: 'file', text: null, attachments: [], payload: { unsupported: true }, unsupportedOnly: true });
    expect(parseInbound(wrap({ message: { mid: 'm_10', attachments: [{ type: 'template', payload: {} }] } }))).toMatchObject({ payload: { unsupported: true }, unsupportedOnly: true });
    expect(parseInbound(wrap({ message: { mid: 'm_11', attachments: [{ type: 'fallback', title: 'Lien', url: 'https://example.dz/p/1', payload: { url: 'https://example.dz/p/1' } }] } }))).toMatchObject({ type: 'text', text: 'https://example.dz/p/1', payload: null });
    expect(parseInbound(wrap({ message: { mid: 'm_12', is_deleted: true } }, 'instagram'))).toMatchObject({ kind: 'deleted', mid: 'm_12' });
    expect(parseInbound(wrap({ message: { text: 'no id' } }))).toEqual({ kind: 'ignored', reason: 'no_mid' });
  });

  it('echo: sender is the page, recipient the customer', () => {
    const p = parseInbound({ object: 'page', entryId: PAGE, time: 1, item: { sender: { id: PAGE }, recipient: { id: PSID }, timestamp: 2, message: { mid: 'm_e', is_echo: true, app_id: 263902037430900, text: 'réponse manuelle' } } });
    expect(p).toMatchObject({ kind: 'echo', channelExternalId: PAGE, customerId: PSID, appId: '263902037430900', text: 'réponse manuelle' });
  });

  it('postback, reaction, read, delivery, unknown', () => {
    expect(parseInbound(wrap({ postback: { mid: 'm_p', title: 'Commander', payload: 'ORDER:1' } }))).toMatchObject({ kind: 'postback', mid: 'm_p', title: 'Commander', data: 'ORDER:1' });
    expect(parseInbound(wrap({ postback: { title: 'Démarrer', payload: 'GET_STARTED' } }))).toMatchObject({ kind: 'postback', title: 'Démarrer' });
    expect(parseInbound(wrap({ reaction: { mid: 'm_1', action: 'react', reaction: 'love', emoji: '❤' } }))).toMatchObject({ kind: 'reaction', mid: 'm_1', reaction: 'like' });
    expect(parseInbound(wrap({ reaction: { mid: 'm_1', action: 'react', reaction: 'dislike', emoji: '👎' } }))).toMatchObject({ reaction: 'dislike' });
    expect(parseInbound(wrap({ reaction: { mid: 'm_1', action: 'unreact' } }))).toMatchObject({ reaction: null });
    expect(parseInbound(wrap({ read: { watermark: 1760184000000 } }))).toMatchObject({ kind: 'read', watermark: 1760184000000 });
    expect(parseInbound(wrap({ delivery: { mids: ['m_a', 'm_b'], watermark: 1 } }))).toMatchObject({ kind: 'delivery', mids: ['m_a', 'm_b'] });
    expect(parseInbound(wrap({ optin: { ref: 'x' } }))).toEqual({ kind: 'ignored', reason: 'unhandled_event' });
    expect(parseInbound({ object: 'page', entryId: PAGE, time: 1, item: { message: { mid: 'x' } } })).toEqual({ kind: 'ignored', reason: 'no_participants' });
  });
});

describe('event ids and webhook bodies', () => {
  it('the message id is the dedup id; events without one get a stable content hash', () => {
    expect(inboundExternalId(PAGE, { message: { mid: 'm_1' } })).toBe('m_1');
    const read = { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: 5, read: { watermark: 9 } };
    expect(inboundExternalId(PAGE, read)).toBe(inboundExternalId(PAGE, { ...read }));
    expect(inboundExternalId(PAGE, read)).toMatch(new RegExp(`^${PAGE}:5:${PSID}:[0-9a-f]{16}$`));
    expect(inboundExternalId(PAGE, read)).not.toBe(inboundExternalId(PAGE, { ...read, read: { watermark: 10 } }));
  });

  it('only `entry[].messaging[]` of page / instagram objects is taken; duplicates inside one body are collapsed', () => {
    const item = { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: 1, message: { mid: 'm_1', text: 'a' } };
    const events = MetaWebhookService.events({ object: 'page', entry: [{ id: PAGE, time: 3, messaging: [item, item], changes: [{ field: 'feed' }] }, { id: PAGE, time: 4, messaging: [{ ...item, message: { mid: 'm_2' } }] }] });
    expect(events.map((e) => e.externalId)).toEqual(['m_1', 'm_2']);
    expect(events[0]!.payload).toEqual({ object: 'page', entryId: PAGE, time: 3, item });
    expect(MetaWebhookService.events({ object: 'user', entry: [{ id: '1', messaging: [item] }] })).toEqual([]);
    expect(MetaWebhookService.events({ object: 'page' })).toEqual([]);
    expect(MetaWebhookService.events(null)).toEqual([]);
    expect(MetaWebhookService.events('nope')).toEqual([]);
  });
});

describe('small helpers', () => {
  it('previewOf: text trimmed to 140 characters, a type token otherwise', () => {
    expect(previewOf({ text: '  Salam \n  khouya ', type: 'text' })).toBe('Salam khouya');
    expect(previewOf({ text: 'x'.repeat(300), type: 'text' })).toHaveLength(140);
    expect(previewOf({ text: null, type: 'audio' })).toBe('[audio]');
  });

  it('containsBlockedWord ignores case and diacritics, Latin and Arabic', () => {
    expect(containsBlockedWord('Quelle ARNAQUE !', ['arnaque'])).toBe(true);
    expect(containsBlockedWord('c\'est une escroquérie', ['Escroquerie'])).toBe(true);
    expect(containsBlockedWord('هذا نَصَّاب', ['نصاب'])).toBe(true);
    expect(containsBlockedWord('merci beaucoup', ['arnaque', ' '])).toBe(false);
    expect(containsBlockedWord(null, ['arnaque'])).toBe(false);
    expect(containsBlockedWord('texte', [])).toBe(false);
  });

  it('containsBlockedWord matches whole words only (retest 12/11: replies with the phone / address were discarded)', () => {
    expect(containsBlockedWord('Pour confirmer : 0555 12 34 56, Cité 200 logements, Bab Ezzouar', ['con', 'ezz', '200'])).toBe(true); // « 200 » is a whole word
    expect(containsBlockedWord('Pour confirmer : 0555 12 34 56, Cité Bab Ezzouar', ['con', 'ezz', 'firm', 'zou'])).toBe(false);
    expect(containsBlockedWord('Une fiche technique complète', ['nique'])).toBe(false);
    expect(containsBlockedWord('Quel con !', ['con'])).toBe(true);
    expect(containsBlockedWord('ce sont des arnaques', ['arnaque'])).toBe(true);
    expect(containsBlockedWord('pas de virement d’avance', ['virement d’avance'])).toBe(true);
    expect(containsBlockedWord('هذا منصب جديد', ['نصب'])).toBe(false);
    expect(containsBlockedWord('هذا نصب', ['نصب'])).toBe(true);
  });
});
