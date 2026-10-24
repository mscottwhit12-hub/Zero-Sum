import { resolveSettings } from '@gn/engine';
import type { Aggregate } from './metrics';
import { SIM_OPTIONS, type ParamSet } from './paramSets';

/** Markdown report: one section per parameter set, recommended set first. */
export function writeReport(
  results: { set: ParamSet; aggs: Aggregate[] }[],
  runs: number,
  recommended: string,
  sensitivity: { name: string; aggs: Aggregate[] }[] = [],
): string {
  const L: string[] = [];
  L.push('# Simulation report', '');
  L.push(`${runs} simulated nights per party size per parameter set. Night length ${SIM_OPTIONS.lengthMinutes} min.`, '');
  L.push('## Summary', '');
  L.push('| Set | 12 players | 20 players |', '|---|---|---|');
  for (const r of results) {
    const cell = (a?: Aggregate) => (a ? `${a.targets.filter((t) => t.pass).length}/${a.targets.length}` : '—');
    L.push(`| ${r.set.name}${r.set.name === recommended ? ' **(recommended)**' : ''} | ${cell(r.aggs.find((a) => a.players === 12))} | ${cell(r.aggs.find((a) => a.players === 20))} |`);
  }
  L.push('');
  for (const r of results) {
    L.push(`## ${r.set.name}`, '', r.set.note, '');
    if (Object.keys(r.set.settings).length) L.push('Changes from defaults:', '', '```json', JSON.stringify(r.set.settings, null, 2), '```', '');
    for (const a of r.aggs) {
      L.push(`### ${a.players} players`, '', '| | Target | Result | Goal |', '|---|---|---|---|');
      for (const t of a.targets) L.push(`| ${t.pass ? '✅' : '❌'} | ${t.label} | ${t.value} | ${t.target} |`);
      L.push('');
      for (const [k, v] of Object.entries(a.extra)) L.push(`- ${k}: ${v}`);
      L.push(`- Mean final gold by agent: ${Object.entries(a.goldByAgent).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`);
      L.push(`- Mean trading P&L by agent: ${Object.entries(a.marketPnlByAgent).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v.toFixed(1)}`).join(', ')}`);
      L.push('');
    }
  }
  if (sensitivity.length) {
    const ids = sensitivity[0]!.aggs[0]!.targets.map((t) => t.id);
    L.push(`## Sensitivity of "${recommended}" to behavior assumptions`, '', `${Math.max(100, Math.round(runs / 2))} nights per cell. Cell = 12p / 20p.`, '');
    L.push(`| Assumption | ${ids.join(' | ')} |`, `|---|${ids.map(() => '---').join('|')}|`);
    for (const sv of sensitivity) {
      const cells = ids.map((id) =>
        sv.aggs.map((a) => { const t = a.targets.find((x) => x.id === id)!; return `${t.pass ? '' : '❌'}${t.value.split(' (')[0]!.split(',')[0]!.replace(' of runs', '')}`; }).join(' / '),
      );
      L.push(`| ${sv.name} | ${cells.join(' | ')} |`);
    }
    L.push('');
  }
  const rec = results.find((r) => r.set.name === recommended);
  if (rec) L.push('## Recommended settings (full)', '', '```json', JSON.stringify(resolveSettings(rec.set.settings), null, 2), '```', '');
  L.push('## Simulation assumptions', '', '```json', JSON.stringify(SIM_OPTIONS, null, 2), '```');
  return L.join('\n');
}
