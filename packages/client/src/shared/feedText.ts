import { t } from './copy';
import { gold, signedGold } from './format';
import type { FeedItem, PlayerInfo } from './types';

/** Renders a feed entry from its copy key + data. */
export function feedText(f: FeedItem, players: PlayerInfo[]): string {
  const name = (id: unknown) => players.find((p) => p.id === Number(id))?.displayName ?? '?';
  const d = f.data as Record<string, unknown>;
  const vars: Record<string, string> = {
    name: String(d.name ?? ''),
    from: name(d.from),
    to: name(d.to),
    by: String(d.by ?? ''),
    player: name(d.playerId),
    gold: typeof d.goldH === 'number' ? signedGold(d.goldH) : '',
    reason: String(d.reason ?? ''),
    winners: Array.isArray(d.winners) && d.winners.length ? (d.winners as unknown[]).map(name).join(' & ') : 'Nobody',
  };
  void gold;
  return t(f.message, vars);
}
