/**
 * One simulated night, narrated: game log, quarterly bounties, hourly gold/net worth, final breakdown.
 * Usage: tsx src/example.ts [seed] [players] [paramSet]
 */
import { resolveSettings, scoreGame, type GameResult } from '@gn/engine';
import { PARAM_SETS, SIM_OPTIONS } from './paramSets';
import { runNight } from './runner';
import { netWorthH, type AgentKind, type World } from './world';

const seed = Number(process.argv[2] ?? 1);
const players = Number(process.argv[3] ?? 12);
const setName = process.argv[4] ?? 'recommended';
const set = PARAM_SETS.find((s) => s.name === setName)!;
const settings = resolveSettings(set.settings);

const STYLE: Record<AgentKind, string> = {
  holder: 'Buy & hold',
  trader: 'Active trader',
  selfPumper: 'Self-pumper',
  coalition: 'Pump crew',
  gambler: 'Crypto gambler',
  random: 'Random clicker',
  inactive: 'Never trades',
};
const g = (h: number) => (h / 100).toFixed(1);
const sg = (h: number) => `${h >= 0 ? '+' : ''}${g(h)}`;
const clock = (min: number) => `${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, '0')}`;
const ord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

const gameLog: string[] = [];
const bountyLog: string[] = [];
const gameGold = new Map<string, number>();
const snaps: { label: string; rows: Map<string, { cash: number; nw: number }> }[] = [];
let world: World | null = null;
let endLines: string[] = [];
let gameNo = 0;
const snapAt = [0, 60, 120, 180, 240];

const snapshot = (w: World, label: string) => {
  const rows = new Map<string, { cash: number; nw: number }>();
  for (const p of w.players) if (p.joinedTick <= w.tick) rows.set(p.id, { cash: w.cash.get(p.id) ?? 0, nw: netWorthH(w, p.id) });
  snaps.push({ label, rows });
};

runNight(
  {
    ...SIM_OPTIONS,
    seed,
    players,
    coalitionTarget: seed % 2 ? 'crypto' : 'dead',
    hooks: {
      onTick(w, min) {
        world = w;
        const at = snapAt.find((m) => Math.abs(min - m) < 1e-9);
        if (at !== undefined) snapshot(w, clock(at));
      },
      onResult(w, r: GameResult, min) {
        gameNo++;
        const rows = scoreGame(r, settings).rows;
        for (const row of rows) gameGold.set(row.playerId, (gameGold.get(row.playerId) ?? 0) + row.goldH);
        const byGold = [...rows].sort((a, b) => b.goldH - a.goldH);
        const part = (pid: string) => r.participants.find((p) => p.playerId === pid)!;
        const label = (pid: string) => {
          const p = part(pid);
          if (p.dnf) return 'DNF';
          if (r.mode === 'coop') return r.coopWon ? 'won' : 'lost';
          if (r.mode === 'team') return p.placement === 1 ? 'winning team' : 'losing team';
          return ord(p.placement!);
        };
        const modeTxt = r.mode === 'coop' ? `co-op, ${r.coopWon ? 'WIN' : 'LOSS'}` : r.mode;
        gameLog.push(
          `| ${clock(min)} | #${gameNo} ${modeTxt} | ${r.participants.length} | ${r.actualHours.toFixed(2)}h | ${byGold.map((x) => `${x.playerId} ${label(x.playerId)} ${sg(x.goldH)}`).join(', ')} |`,
        );
      },
      onBounty(w, q, payouts, winners, min) {
        bountyLog.push(
          `- **Q${q}** resolved at ${clock(min)}. Net-worth leader: ${winners.join(', ')}. Correct voters paid +${g(settings.votes.bountyGold * 100)} each: ${payouts.map((p) => p.playerId).join(', ') || 'none'}.`,
        );
      },
      onEnd(w, end) {
        world = w;
        const nightMin = (w.closeTick * w.tickMs) / 60_000;
        const rows = new Map<string, { cash: number; nw: number }>();
        for (const [id, l] of end.ledger) rows.set(id, { cash: l.cashH, nw: l.cashH });
        snaps.push({ label: `End ${clock(nightMin)}`, rows });
        const fee = new Map<string, number>();
        for (const t of end.liquidations) fee.set(t.playerId, (fee.get(t.playerId) ?? 0) + t.feeH);
        const sum = (arr: { playerId: string; goldH: number }[], id: string) => arr.filter((x) => x.playerId === id).reduce((a, x) => a + x.goldH, 0);
        const bounties = [...w.ledger.bounties, ...(end.quarter?.payouts ?? [])];
        endLines = end.podium.map((r) => {
          const l = end.ledger.get(r.playerId)!;
          const p = w.players.find((x) => x.id === r.playerId)!;
          const extras = sum(w.ledger.adjustments, r.playerId);
          return `| ${r.rank} | ${r.playerId} | ${STYLE[p.agent]}${p.joinedTick > 0 ? ' (late joiner)' : ''}${p.leftTick !== null ? ' (left early)' : ''} | ${g(l.stakeH)} | ${g(gameGold.get(r.playerId) ?? 0)} | ${g(sum(bounties, r.playerId))} | ${g(l.achievementsH)} | ${g(extras)} | ${sg(l.tradeFlowH)} | ${g(fee.get(r.playerId) ?? 0)} | **${g(l.cashH)}** |`;
        });
      },
    },
  },
  settings,
);

const w = world!;
const ids = w.players.map((p) => p.id);
const L: string[] = [];
L.push(`# Example night — ${players} players`, '');
L.push(`Seed ${seed}, settings package \`${setName}\`. One simulated 5-hour night, not hand-picked. Gold shown to 1 decimal.`, '');
L.push('## Players', '', ids.map((id) => `${id}: ${STYLE[w.players.find((p) => p.id === id)!.agent]}`).join(' · '), '');
L.push('## Gold through the night', '', 'Gold = gold on hand. In brackets: net worth (gold + what their stocks would sell for right now) when they hold stocks. Ranking uses net worth.', '');
L.push(`| Player | ${snaps.map((s) => s.label).join(' | ')} |`, `|---|${snaps.map(() => '---:').join('|')}|`);
const final = snaps[snaps.length - 1]!.rows;
for (const id of [...ids].sort((a, b) => (final.get(b)?.cash ?? 0) - (final.get(a)?.cash ?? 0))) {
  L.push(
    `| ${id} | ${snaps
      .map((s) => {
        const r = s.rows.get(id);
        if (!r) return '—';
        return r.nw !== r.cash ? `${g(r.cash)} (${g(r.nw)})` : g(r.cash);
      })
      .join(' | ')} |`,
  );
}
L.push('', '## Game log', '', '| Time | Game | Players | Length | Gold awarded |', '|---|---|---|---|---|', ...gameLog, '');
L.push('## Quarterly votes', '', ...bountyLog, '');
L.push('## Final breakdown', '');
L.push('| # | Player | Style | Stake | Games | Bounties | Achievements | Espionage / late-join | Trading P&L | End fee | Final gold |', '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|', ...endLines);
console.log(L.join('\n'));
