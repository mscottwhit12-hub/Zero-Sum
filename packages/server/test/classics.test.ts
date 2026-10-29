import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { listLibrary, seedClassics } from '../src/services/library';
import { makeApp } from './helpers';

const PACK = fileURLToPath(new URL('../../../assets/classics.json', import.meta.url));

describe('classic games seeding', () => {
  it('adds each classic once by name; deleted ones stay deleted', async () => {
    const t = await makeApp();
    const n = seedClassics(t.ctx, PACK);
    const names = listLibrary(t.ctx).map((g) => g.name);
    expect(names).toEqual(expect.arrayContaining(['Risk', 'Ticket to Ride', 'Ticket to Ride: Europe']));
    expect(n).toBe(names.length);
    expect(listLibrary(t.ctx).find((g) => g.name === 'Ticket to Ride')!.board).toBe('ticket-to-ride');
    t.ctx.db.prepare("DELETE FROM library_game WHERE name = 'Ticket to Ride'").run();
    expect(seedClassics(t.ctx, PACK)).toBe(0);
    expect(listLibrary(t.ctx).some((g) => g.name === 'Ticket to Ride')).toBe(false);
  });
  it('an install that ran the old once-only seed gets the new games, not Risk again', async () => {
    const t = await makeApp();
    t.ctx.db.prepare("INSERT INTO meta (key, value) VALUES ('classics_seeded', '1')").run();
    seedClassics(t.ctx, PACK);
    const names = listLibrary(t.ctx).map((g) => g.name);
    expect(names).not.toContain('Risk');
    expect(names).toContain('Ticket to Ride');
  });
});
