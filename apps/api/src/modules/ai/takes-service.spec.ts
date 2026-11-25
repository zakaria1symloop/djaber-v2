// Client list L51 (live test chat 25/11): « je veux votre service de création de site web » names no catalogue product — after the name
// and the phone the agent asked the wilaya. The order of a service is not delivered whatever the way the customer asked for it.
import { takesService } from './ai-run.service';

const catalogue = [
  { id: 'web', name: 'Website Development (تصميم وتطوير مواقع إلكترونية)', price: 30000, variants: [] },
  { id: 'sac', name: 'Recette Sac en cuir', price: 4000, variants: [] },
];
const stock = [
  { id: 'web', stock: null, sell: true, variants: [] },
  { id: 'sac', stock: 5, sell: false, variants: [] },
];

describe('takesService', () => {
  it('the product the customer names decides', () => {
    expect(takesService('je veux commander le service website development', catalogue, stock)).toBe(true);
    expect(takesService('je veux la recette sac en cuir', catalogue, stock)).toBe(false);
    // named last wins over what was shown before
    expect(takesService('je veux la recette sac en cuir', catalogue, stock, ['web'])).toBe(false);
  });

  it('with no product named, the product chosen earlier or last shown decides', () => {
    const said = 'bonjour, je veux votre service de création de site web\nIlyes Test, 0550123456';
    expect(takesService(said, catalogue, stock)).toBe(false);
    expect(takesService(said, catalogue, stock, ['web'])).toBe(true);
    expect(takesService(said, catalogue, stock, ['sac', 'web'])).toBe(false);
    expect(takesService(said, catalogue, stock, ['gone', 'web'])).toBe(true); // an id that left the catalogue is skipped
  });

  it('a shop that sells only services never delivers', () => {
    expect(takesService('je veux commander', [catalogue[0]!], [stock[0]!])).toBe(true);
    expect(takesService('je veux commander', [], [])).toBe(false);
  });
});
