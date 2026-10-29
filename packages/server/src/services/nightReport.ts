/**
 * End-of-night package (Oct 29 feedback item 4): every stat that pertains to one player or the night, placed
 * functionally (Server styles it later). Used by the phone statement, the statement PDF, the shareable image cards
 * (SVG; the phone saves them as PNG) and the GM's zip with the night summary.
 * Hidden mechanics stay hidden: no drift, no price causes, no hidden achievement gold, no chat content.
 */
import { scoreGame } from '@gn/engine';
import type { Ctx } from '../context';
import { minterLeaderboard } from './minter';
import { computeNightState, loadResults, nightSettings, pid, type NightRow, type NightState, type PlayerRow } from './state';

const SAMPLE = 60;

/** Up to `n` evenly spaced points of a series (first and last kept). */
function sample<T>(xs: T[], n = SAMPLE): T[] {
  if (xs.length <= n) return xs;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(xs[Math.round((i * (xs.length - 1)) / (n - 1))]!);
  return out;
}

export function priceSeries(ctx: Ctx, nightId: number, securityId: string): { t: number; p: number }[] {
  const rows = ctx.db.prepare('SELECT created_at t, price p FROM price WHERE night_id = ? AND security_id = ? ORDER BY id').all(nightId, securityId) as { t: number; p: number }[];
  return sample(rows);
}

export interface PlayerStats {
  netWorthLine: { t: number; v: number }[]; // gold (hundredths) after each result + final
  games: { name: string; placement: number | null; dnf: boolean; players: number; goldH: number }[];
  gameGoldH: number;
  tradeCount: number;
  feesH: number;
  bestShortH: number | null;
  ownStock: { ticker: string; line: { t: number; p: number }[]; high: number; low: number; close: number } | null;
  biggestBacker: { name: string; sharesH: number } | null;
  bountiesH: number;
  rerollsUsed: number;
  minterRank: number | null;
  playHours: number;
  idleHours: number;
  chatMessages: number;
  title: string;
}

export function playerStats(ctx: Ctx, n: NightRow, st: NightState, player: PlayerRow, base: { tradingResultH: number; correctVotes: number; votesCast: number; nftsMinted: number; achievements: string[]; rank: number | null }): PlayerStats {
  const settings = nightSettings(n);
  const id = pid(player.id);
  const nameOf = (x: number) => st.players.find((p) => p.id === x)?.display_name ?? '?';
  // Net worth after each result (standings snapshots) and the final number.
  const snaps = (ctx.db.prepare('SELECT data, created_at FROM standings_snapshot WHERE night_id = ? ORDER BY id').all(n.id) as { data: string; created_at: number }[])
    .map((r) => ({ t: r.created_at, v: (JSON.parse(r.data) as { playerId: number; netWorthH: number }[]).find((x) => x.playerId === player.id)?.netWorthH }))
    .filter((x): x is { t: number; v: number } => x.v != null);
  const final = st.standings.find((r) => r.playerId === id)?.netWorthH;
  const netWorthLine = sample([...(player.joined_at ? [{ t: player.joined_at, v: snaps[0]?.v ?? final ?? 0 }] : []), ...snaps, ...(final != null ? [{ t: n.ended_at ?? ctx.now(), v: final }] : [])]);
  // Games and the gold each paid.
  const names = new Map((ctx.db.prepare('SELECT id, name FROM game WHERE night_id = ?').all(n.id) as { id: number; name: string }[]).map((g) => [String(g.id), g.name]));
  const games: PlayerStats['games'] = [];
  let playHours = 0;
  for (const r of loadResults(ctx, n.id)) {
    const me = r.participants.find((p) => p.playerId === id);
    if (!me) continue;
    const row = scoreGame(r, settings).rows.find((x) => x.playerId === id);
    games.push({ name: names.get(r.id) ?? 'Game', placement: me.placement ?? null, dnf: !!me.dnf, players: r.participants.length, goldH: row?.goldH ?? 0 });
    playHours += r.actualHours;
  }
  const trades = ctx.db.prepare('SELECT side, short, cash_h, fee_h, basis_h, forced FROM trade WHERE night_id = ? AND player_id = ?').all(n.id, player.id) as {
    side: string;
    short: number;
    cash_h: number;
    fee_h: number;
    basis_h: number | null;
    forced: number;
  }[];
  const shortWins = trades.filter((t) => t.short && t.side === 'buy' && t.basis_h != null).map((t) => t.cash_h - t.basis_h!);
  // Their own stock: price line, high/low/close.
  const secId = `p:${player.id}`;
  const line = priceSeries(ctx, n.id, secId);
  const ticker = st.securities.find((s) => s.id === secId)?.ticker ?? player.ticker;
  const ownStock = line.length ? { ticker, line, high: Math.max(...line.map((x) => x.p)), low: Math.min(...line.map((x) => x.p)), close: line[line.length - 1]!.p } : null;
  // Biggest backer: who bought the most shares of their stock (longs; not themselves).
  const backer = ctx.db
    .prepare("SELECT player_id, SUM(shares_h) s FROM trade WHERE night_id = ? AND security_id = ? AND side = 'buy' AND short = 0 AND forced = 0 AND player_id != ? GROUP BY player_id ORDER BY s DESC LIMIT 1")
    .get(n.id, secId, player.id) as { player_id: number; s: number } | undefined;
  const bountiesH = (ctx.db.prepare('SELECT COALESCE(SUM(b.gold_h),0) g FROM bounty_payout b JOIN vote_round v ON v.id = b.vote_round_id WHERE v.night_id = ? AND b.player_id = ?').get(n.id, player.id) as { g: number }).g;
  const rerollsUsed = (ctx.db.prepare('SELECT COUNT(*) c FROM reroll_use r JOIN game g ON g.id = r.game_id WHERE g.night_id = ? AND r.player_id = ?').get(n.id, player.id) as { c: number }).c;
  const lb = minterLeaderboard(ctx, n.id, 1000);
  const mi = lb.findIndex((x) => x.playerId === player.id);
  const chatMessages = (ctx.db.prepare('SELECT COUNT(*) c FROM chat_message WHERE night_id = ? AND player_id = ?').get(n.id, player.id) as { c: number }).c;
  const presentMs = Math.max(0, (player.left_at ?? n.ended_at ?? ctx.now()) - Math.max(player.joined_at ?? 0, n.started_at ?? 0));
  const presentH = presentMs / 3_600_000;
  const stats: PlayerStats = {
    netWorthLine,
    games,
    gameGoldH: games.reduce((a, g) => a + g.goldH, 0),
    tradeCount: trades.filter((t) => !t.forced).length,
    feesH: trades.reduce((a, t) => a + t.fee_h, 0),
    bestShortH: shortWins.some((x) => x > 0) ? Math.max(...shortWins) : null,
    ownStock,
    biggestBacker: backer ? { name: nameOf(backer.player_id), sharesH: backer.s } : null,
    bountiesH,
    rerollsUsed,
    minterRank: mi >= 0 ? mi + 1 : null,
    playHours: Math.round(playHours * 100) / 100,
    idleHours: Math.max(0, Math.round((presentH - playHours) * 100) / 100),
    chatMessages,
    title: '',
  };
  stats.title = funTitle(stats, base, st.players.length);
  return stats;
}

/** One fun title from how they played (first rule that fits). */
export function funTitle(s: PlayerStats, b: { tradingResultH: number; correctVotes: number; votesCast: number; nftsMinted: number; achievements: string[]; rank: number | null }, players: number): string {
  const wins = s.games.filter((g) => g.placement === 1).length;
  const lasts = s.games.filter((g) => g.placement != null && g.placement === g.players && g.players > 1).length;
  if (b.rank === 1) return 'Chairman of the Board';
  if (s.bestShortH != null && s.bestShortH > 300) return 'The Short Seller';
  if (wins >= 2) return 'Serial Winner';
  if (b.tradingResultH > 500) return 'Market Maker';
  if (b.tradingResultH < -500) return 'Bag Holder';
  if (s.tradeCount === 0) return 'Diamond Hands';
  if (s.tradeCount >= 20) return 'Day Trader';
  if (b.votesCast > 0 && b.correctVotes === b.votesCast && b.votesCast >= 2) return 'The Oracle';
  if (b.nftsMinted >= 1000) return 'Crypto Bro';
  if (s.chatMessages >= 30) return 'Insider Source';
  if (lasts >= 2) return 'Comeback Pending';
  if (s.idleHours > s.playHours && s.idleHours > 1) return 'Professional Spectator';
  if (b.rank != null && b.rank === players) return 'Under Audit';
  return 'Associate in Good Standing';
}

// ---------------------------------------------------------------- image cards (SVG)

const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const gold = (h: number) => (h / 100).toFixed(2);
const signed = (h: number) => `${h >= 0 ? '+' : '−'}${gold(Math.abs(h))}`;

function sparkPath(vals: number[], x: number, y: number, w: number, h: number): string {
  if (vals.length < 2) return '';
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  return vals.map((v, i) => `${i ? 'L' : 'M'}${(x + (i * w) / (vals.length - 1)).toFixed(1)},${(y + h - ((v - lo) / span) * h).toFixed(1)}`).join(' ');
}

/** 3 phone-sized cards (1080×1350), in the phone theme's colours. Plain on purpose: Server styles them later. */
export function playerCards(stmt: { night: { name: string; date: string }; player: { displayName: string; ticker: string }; goldH: number; rank: number | null; players: number; tradingResultH: number; correctVotes: number; votesCast: number; nftsMinted: number; bestTrade: { ticker: string; profitH: number | null } | null }, s: PlayerStats, brand: string): string[] {
  const W = 1080;
  const H = 1350;
  const frame = (body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0b0f0e"/><rect x="60" y="60" width="${W - 120}" height="${H - 120}" fill="#131a18" stroke="#c9a24a" stroke-dasharray="10 8" stroke-width="2"/>` +
    `<text x="110" y="150" font-family="monospace" font-size="30" fill="#98a29a" letter-spacing="6">${esc(brand.toUpperCase())}</text>` +
    `<text x="110" y="${H - 110}" font-family="monospace" font-size="26" fill="#98a29a">${esc(stmt.night.name)} · ${esc(stmt.night.date)}</text>${body}</svg>`;
  const t = (x: number, y: number, size: number, txt: string, fill = '#ece8da', family = 'Georgia, serif') => `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" fill="${fill}">${esc(txt)}</text>`;
  const kv = (y: number, k: string, v: string, fill = '#ece8da') => t(110, y, 34, k, '#98a29a', 'sans-serif') + `<text x="${W - 110}" y="${y}" text-anchor="end" font-family="monospace" font-size="40" fill="${fill}">${esc(v)}</text>`;
  const card1 = frame(
    t(110, 300, 90, stmt.player.displayName) +
      t(110, 370, 36, `(${stmt.player.ticker})`, '#98a29a', 'monospace') +
      t(110, 500, 56, s.title, '#c9a24a') +
      kv(640, 'Final rank', stmt.rank == null ? '—' : `${stmt.rank} of ${stmt.players}`) +
      kv(720, 'Final gold', gold(stmt.goldH)) +
      kv(800, 'Gold from games', gold(s.gameGoldH)) +
      kv(880, 'Trading result', signed(stmt.tradingResultH), stmt.tradingResultH >= 0 ? '#4fcdb8' : '#f08462') +
      `<path d="${sparkPath(s.netWorthLine.map((x) => x.v), 110, 940, W - 220, 190)}" fill="none" stroke="#4fcdb8" stroke-width="5"/>` +
      t(110, 1180, 26, 'Net worth across the night', '#98a29a', 'sans-serif'),
  );
  const o = s.ownStock;
  const card2 = frame(
    t(110, 300, 70, 'The market') +
      (o
        ? t(110, 380, 36, `${o.ticker}: high ${o.high.toFixed(2)} · low ${o.low.toFixed(2)} · close ${o.close.toFixed(2)}`, '#b9c3bc', 'monospace') +
          `<path d="${sparkPath(o.line.map((x) => x.p), 110, 420, W - 220, 300)}" fill="none" stroke="#c9a24a" stroke-width="5"/>`
        : '') +
      kv(820, 'Best trade', stmt.bestTrade?.profitH != null ? `${stmt.bestTrade.ticker} ${signed(stmt.bestTrade.profitH)}` : '—') +
      kv(900, 'Biggest short win', s.bestShortH != null ? signed(s.bestShortH) : '—') +
      kv(980, 'Trades · fees', `${s.tradeCount} · ${gold(s.feesH)}`) +
      kv(1060, 'Biggest backer', s.biggestBacker ? s.biggestBacker.name : '—'),
  );
  const gameLines = s.games.slice(0, 6).map((g, i) => kv(400 + i * 70, g.name, g.dnf ? 'DNF' : g.placement != null ? `${g.placement}/${g.players} · +${gold(g.goldH)}` : `+${gold(g.goldH)}`)).join('');
  const card3 = frame(
    t(110, 300, 70, 'The night') +
      gameLines +
      kv(880, 'Quarter picks right', `${stmt.correctVotes} of ${stmt.votesCast}`) +
      kv(950, 'Bounties', gold(s.bountiesH)) +
      kv(1020, 'NFTs minted', `${stmt.nftsMinted.toLocaleString('en-US')}${s.minterRank ? ` (#${s.minterRank})` : ''}`) +
      kv(1090, 'Playing · idle', `${s.playHours.toFixed(1)} h · ${s.idleHours.toFixed(1)} h`) +
      kv(1160, 'Re-rolls · messages', `${s.rerollsUsed} · ${s.chatMessages}`),
  );
  return [card1, card2, card3];
}

// ---------------------------------------------------------------- night summary (GM)

export function nightSummary(ctx: Ctx, n: NightRow) {
  const st = computeNightState(ctx, n.id)!;
  const settings = nightSettings(n);
  const nameOf = (id: string) => st.players.find((p) => pid(p.id) === id)?.display_name ?? '?';
  const leaderboard = st.standings.map((r) => ({ rank: r.rank, name: nameOf(r.playerId), goldH: r.netWorthH }));
  const names = new Map((ctx.db.prepare('SELECT id, name FROM game WHERE night_id = ?').all(n.id) as { id: number; name: string }[]).map((g) => [String(g.id), g.name]));
  const games = loadResults(ctx, n.id).map((r) => {
    const rows = new Map(scoreGame(r, settings).rows.map((x) => [x.playerId, x.goldH]));
    return {
      name: names.get(r.id) ?? 'Game',
      hours: r.actualHours,
      places: [...r.participants].sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99)).map((p) => ({ name: nameOf(p.playerId), placement: p.placement, dnf: p.dnf, goldH: rows.get(p.playerId) ?? 0 })),
    };
  });
  const movers = st.securities
    .map((s) => {
      const first = ctx.db.prepare('SELECT price FROM price WHERE night_id = ? AND security_id = ? ORDER BY id LIMIT 1').get(n.id, s.id) as { price: number } | undefined;
      const open = first?.price ?? s.price;
      return { ticker: s.ticker, open, close: s.price, change: open ? (s.price - open) / open : 0 };
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 8);
  const lineOf = (kind: string) => {
    const sec = st.securities.find((s) => s.kind === kind);
    return sec ? { ticker: sec.ticker, line: priceSeries(ctx, n.id, sec.id) } : null;
  };
  return { night: { name: n.name, date: n.date }, leaderboard, games, movers, index: lineOf('index'), coin: lineOf('crypto') };
}
export type NightSummary = ReturnType<typeof nightSummary>;
