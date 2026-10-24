import type { NightMetrics } from './runner';
import type { AgentKind } from './world';

export interface TargetResult {
  id: string;
  label: string;
  value: string;
  target: string;
  pass: boolean;
}

export interface Aggregate {
  runs: number;
  players: number;
  targets: TargetResult[];
  extra: Record<string, string>;
  goldByAgent: Record<string, number>;
  marketPnlByAgent: Record<string, number>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const gold = (h: number) => (h / 100).toFixed(1);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

export function aggregate(ms: NightMetrics[]): Aggregate {
  const n = ms.length;
  const share = ms.map((m) => m.winnerMarketShare);
  const pumpRuns = ms.filter((m) => m.soloPump.noRankChangeTrips > 0);
  const pumpUnprofitable = pumpRuns.filter((m) => m.soloPump.noRankChangePnlH <= 0).length / Math.max(1, pumpRuns.length);
  const coalRuns = ms.filter((m) => m.coalition.trips > 0);
  const coalRoi = coalRuns.reduce((a, m) => a + m.coalition.pnlH, 0) / Math.max(1, coalRuns.reduce((a, m) => a + m.coalition.costH, 0));
  const coalPerMember = mean(coalRuns.map((m) => m.coalition.pnlH / 3));
  const coalProfitable = coalRuns.filter((m) => m.coalition.pnlH > 0).length / Math.max(1, coalRuns.length);
  const byTarget = (t: 'crypto' | 'dead') => {
    const r = coalRuns.filter((m) => m.coalitionTarget === t);
    return {
      roi: r.reduce((a, m) => a + m.coalition.pnlH, 0) / Math.max(1, r.reduce((a, m) => a + m.coalition.costH, 0)),
      perMember: mean(r.map((m) => m.coalition.pnlH / 3)),
      profitable: r.filter((m) => m.coalition.pnlH > 0).length / Math.max(1, r.length),
    };
  };
  const cc = byTarget('crypto');
  const cd = byTarget('dead');
  const bq = ms.filter((m) => m.bottomQuartileTop3).length / n;
  const ml = ms.filter((m) => m.midLeaderWon).length / n;
  const all = (k: AgentKind) => ms.flatMap((m) => m.goldByAgent[k] ?? []);
  const allPnl = (k: AgentKind) => ms.flatMap((m) => m.marketPnlByAgent[k] ?? []);
  const traderVsInactive = mean(all('trader')) / Math.max(1, mean(all('inactive'))) - 1;
  const pDelta = mean(ms.map((m) => m.playerAbsDelta));
  const cDelta = mean(ms.map((m) => m.cryptoAbsDelta));
  const kinds = ['player', 'index', 'crypto', 'event', 'dead'];
  const pinnedViol = ms.filter((m) => Object.values(m.pinnedMaxByKind).some((f) => f > 0.2)).length / n;
  const pinnedByKind = kinds.map((k) => `${k} ${pct(ms.filter((m) => (m.pinnedMaxByKind[k] ?? 0) > 0.2).length / n, 1)}`).join(', ');

  const targets: TargetResult[] = [
    { id: 'T1', label: "Market share of winner's final gold (mean)", value: `${pct(mean(share))} (median ${pct(median(share))})`, target: '10–30%', pass: mean(share) >= 0.1 && mean(share) <= 0.3 },
    { id: 'T2', label: 'Solo pump with no rank change is unprofitable', value: `${pct(pumpUnprofitable)} of runs`, target: '≥80% of runs', pass: pumpUnprofitable >= 0.8 },
    {
      id: 'T3',
      label: '3-player coalition pump (crypto/dead) makes a modest profit',
      value: `ROI ${pct(coalRoi, 1)}, +${gold(coalPerMember)} gold/member/night, profitable in ${pct(coalProfitable)} of runs`,
      target: 'ROI 2–15% and profitable in ≥55% of runs',
      pass: coalRoi >= 0.02 && coalRoi <= 0.15 && coalProfitable >= 0.55,
    },
    { id: 'T4', label: 'Bottom quartile at midpoint reaches top 3', value: pct(bq, 1), target: '5–15% of runs', pass: bq >= 0.05 && bq <= 0.15 },
    { id: 'T5', label: 'Midpoint leader wins', value: pct(ml, 1), target: '≤60%', pass: ml <= 0.6 },
    { id: 'T6', label: 'Active traders vs inactive (final gold)', value: `${traderVsInactive >= 0 ? '+' : ''}${pct(traderVsInactive, 1)}`, target: '+5–15%', pass: traderVsInactive >= 0.05 && traderVsInactive <= 0.15 },
    { id: 'T7a', label: 'Player stock mean |Δ| per tick', value: pct(pDelta, 2), target: '<2%', pass: pDelta < 0.02 },
    { id: 'T7b', label: 'Crypto mean |Δ| per tick', value: pct(cDelta, 1), target: '5–15%', pass: cDelta >= 0.05 && cDelta <= 0.15 },
    { id: 'T8', label: 'Runs where any security sits at a band edge >20% of the night', value: pct(pinnedViol, 1), target: '≤5% of runs', pass: pinnedViol <= 0.05 },
  ];
  const agents: AgentKind[] = ['holder', 'trader', 'selfPumper', 'coalition', 'gambler', 'random', 'inactive'];
  return {
    runs: n,
    players: ms[0]?.players ?? 0,
    targets,
    extra: {
      'Winner gold (mean)': gold(mean(ms.map((m) => m.winnerGoldH))),
      'Games per night (mean)': mean(ms.map((m) => m.games)).toFixed(1),
      'Coalition on crypto': `ROI ${pct(cc.roi, 1)}, +${gold(cc.perMember)}/member, profitable ${pct(cc.profitable)}`,
      'Coalition on dead stock': `ROI ${pct(cd.roi, 1)}, +${gold(cd.perMember)}/member, profitable ${pct(cd.profitable)}`,
      'Pinned >20% by kind': pinnedByKind,
      'End-of-night profit fee (mean total)': gold(mean(ms.map((m) => m.endFeeH))),
      'Bounty paid per night (mean total)': gold(mean(ms.map((m) => m.bountyPaidH))),
      'Kingfalls per night (mean)': mean(ms.map((m) => m.kingfalls)).toFixed(1),
      'Winner by agent type': agents.map((k) => `${k} ${pct(ms.filter((m) => m.winnerAgent === k).length / n)}`).join(', '),
    },
    goldByAgent: Object.fromEntries(agents.map((k) => [k, mean(all(k)) / 100])),
    marketPnlByAgent: Object.fromEntries(agents.map((k) => [k, mean(allPnl(k)) / 100])),
  };
}

export function score(a: Aggregate[]): number {
  return a.reduce((s, x) => s + x.targets.filter((t) => t.pass).length, 0);
}
