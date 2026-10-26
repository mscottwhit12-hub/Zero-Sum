/** Placeholder cue sounds (used when no file is uploaded for a cue): short synthesized tones. */
const PATTERNS: Record<string, [number, number][]> = {
  // [frequency Hz, duration s]
  final_round: [[660, 0.15], [660, 0.15], [880, 0.4]],
  intermission: [[523, 0.3], [392, 0.5]],
  achievement: [[784, 0.12], [988, 0.12], [1319, 0.35]],
  night_end: [[440, 0.3], [349, 0.3], [262, 0.7]],
  collapse: [[220, 0.25], [196, 0.25], [147, 0.25], [110, 0.9]],
};

export function cueTone(ctx: AudioContext, cue: string) {
  let t = ctx.currentTime + 0.02;
  for (const [f, d] of PATTERNS[cue] ?? [[600, 0.2]]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + d + 0.05);
    t += d + 0.04;
  }
}
