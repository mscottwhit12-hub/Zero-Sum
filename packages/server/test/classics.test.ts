import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { importPack, listLibrary, seedClassics } from '../src/services/library';
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

  it('importing a pack whose entry has no board keeps the board (the old test pack stripped Risk)', async () => {
    const t = await makeApp();
    seedClassics(t.ctx, PACK);
    const risk = () => listLibrary(t.ctx).find((g) => g.name === 'Risk')!;
    expect(risk().board).toBe('risk');
    const res = importPack(t.ctx, null, { format: 'game-night-pack/1', games: [{ name: 'Risk', defaultDuration: 3, leadLabel: 'Territories' }] });
    expect(res.updated).toBe(1);
    expect(risk().board).toBe('risk');
    expect(risk().defaultDuration).toBe(3); // the rest of the entry still applies
    // an explicit "board": null (a pack exported from a game without a board) doesn't strip it either
    importPack(t.ctx, null, { format: 'game-night-pack/1', games: [{ name: 'Risk', board: null }] });
    expect(risk().board).toBe('risk');
    // a pack can still set a board on a game that has none
    importPack(t.ctx, null, { format: 'game-night-pack/1', games: [{ name: 'Custom', board: 'monopoly' }] });
    expect(listLibrary(t.ctx).find((g) => g.name === 'Custom')!.board).toBe('monopoly');
  });
  it('repair: a classic that already lost its board gets it back on boot; other boards are left alone', async () => {
    const t = await makeApp();
    seedClassics(t.ctx, PACK);
    t.ctx.db.prepare("UPDATE library_game SET board = NULL WHERE name = 'Risk'").run(); // what the old import did
    t.ctx.db.prepare("UPDATE library_game SET board = 'other-board' WHERE name = 'Monopoly'").run();
    seedClassics(t.ctx, PACK);
    const by = (n: string) => listLibrary(t.ctx).find((g) => g.name === n)!;
    expect(by('Risk').board).toBe('risk');
    expect(by('Monopoly').board).toBe('other-board');
    expect(t.ctx.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'library.repair_board'").get()).toEqual({ c: 1 });
    seedClassics(t.ctx, PACK); // nothing left to repair: no second audit row
    expect(t.ctx.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'library.repair_board'").get()).toEqual({ c: 1 });
  });
});
