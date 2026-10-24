import { resolveSettings, type DeepPartial, type Settings } from '@gn/engine';
import { runNight, type NightMetrics } from './runner';
import { SIM_OPTIONS } from './paramSets';

export interface Job {
  settings: DeepPartial<Settings>;
  players: number;
  seeds: number[];
  options?: Partial<typeof SIM_OPTIONS>;
}

export function runJob(job: Job): NightMetrics[] {
  const s = resolveSettings(job.settings);
  return job.seeds.map((seed) =>
    runNight({ ...SIM_OPTIONS, ...job.options, seed, players: job.players, coalitionTarget: seed % 2 ? 'crypto' : 'dead' }, s),
  );
}

if (process.send) {
  process.on('message', (job: Job) => {
    // Exit only after the (large) result has been flushed to the parent.
    process.send!(runJob(job), () => process.exit(0));
  });
}
