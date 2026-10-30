/** Plain-language text for audit log entries (the GM Audit screen). "Computer speak" shows the raw entries instead. */
export type AuditEntry = { id: number; gmName: string | null; action: string; entity: string; entityId: string | null; before: string | null; after: string | null; createdAt: number };
export type AuditNames = { players: Record<string, string>; games: Record<string, string>; tables: Record<string, string>; library: Record<string, string> };
export const NO_NAMES: AuditNames = { players: {}, games: {}, tables: {}, library: {} };

type Obj = Record<string, unknown>;
const parse = (s: string | null): Obj => {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Obj) : {};
  } catch {
    return {};
  }
};
const words = (k: string) => k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/** Flat `path → value` for an object tree (arrays and scalars are leaves). */
function flatten(v: unknown, path: string, out: Map<string, unknown>) {
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Obj)) flatten(x, path ? `${path}.${k}` : k, out);
  else out.set(path, v);
}

export function describeEntry(e: AuditEntry, names: AuditNames = NO_NAMES): { text: string; lines: string[] } {
  const a = parse(e.after);
  const b = parse(e.before);
  const w = e.gmName ?? 'The system';
  const player = (id: unknown) => (id == null || id === '' ? 'someone' : (names.players[String(id)] ?? `player #${id}`));
  const game = (id: unknown) => names.games[String(id)] ?? `game #${id}`;
  const table = (id: unknown) => names.tables[String(id)] ?? `table #${id}`;
  const list = (v: unknown, f: (x: unknown) => string) => (Array.isArray(v) ? v.map(f).join(', ') : '');
  const gold = (h: unknown) => (Number(h) / 100).toFixed(2);

  /** One value, in words. `key` is the last part of its path (decides whether a number is a player, table, …). */
  const val = (v: unknown, key = ''): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (Array.isArray(v)) return v.length ? v.map((x) => val(x, key)).join(', ') : 'none';
    if (typeof v === 'object') return JSON.stringify(v);
    if (/(^|_)by$|By$|^playerId$|^leaderId$|^player_id$/.test(key) && names.players[String(v)]) return names.players[String(v)]!;
    if (key === 'table_id' || key === 'tableId') return table(v);
    if (key === 'library_game_id') return names.library[String(v)] ?? `#${v}`;
    return String(v);
  };
  /** "players.12.territories" → "Ann · territories". */
  const label = (path: string) => {
    const parts = path.split('.');
    const out: string[] = [];
    let who = '';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (p === 'players' && /^\d+$/.test(parts[i + 1] ?? '')) continue;
      if (/^\d+$/.test(p) && names.players[p] && !who) who = names.players[p]!;
      else out.push(words(p));
    }
    return who ? `${who} · ${out.join(' ')}`.trim() : out.join(' ');
  };
  const diff = (before: Obj, after: Obj): string[] => {
    const x = new Map<string, unknown>();
    const y = new Map<string, unknown>();
    flatten(before, '', x);
    flatten(after, '', y);
    const lines: string[] = [];
    let more = 0;
    for (const p of new Set([...x.keys(), ...y.keys()])) {
      if (p === 'id') continue; // the row's own id: only present on one side of some entries
      if (p === '_more') {
        more += Number(y.get(p) ?? 0);
        continue;
      }
      if (JSON.stringify(x.get(p)) === JSON.stringify(y.get(p))) continue;
      const key = p.split('.').pop() ?? p;
      lines.push(`${label(p)}: ${val(x.get(p), key)} → ${val(y.get(p), key)}`);
    }
    if (more) lines.push(`…and ${more} more changes`);
    return lines;
  };
  const ranking = (r: Obj) => {
    const ps = (Array.isArray(r.participants) ? r.participants : []) as Obj[];
    const placed = ps.filter((p) => p.placement != null && !p.dnf).sort((m, n) => Number(m.placement) - Number(n.placement));
    const dnf = ps.filter((p) => p.dnf);
    return [...placed.map((p) => `${p.placement}. ${player(p.playerId)}`), ...(dnf.length ? [`did not finish: ${dnf.map((p) => player(p.playerId)).join(', ')}`] : [])].join(', ');
  };
  const stock = (id: string | null) => (id?.startsWith('p:') ? `${player(id.slice(2))}'s stock` : (id ?? 'a stock'));
  const nightVerb: Record<string, string> = { openJoins: 'opened joining', start: 'started the night', pause: 'paused the night', resume: 'resumed the night', closeTrading: 'closed trading', end: 'ended the night', archive: 'archived the night' };
  const done = (text: string, lines: string[] = []) => ({ text, lines });

  switch (e.action) {
    case 'setup.master': return done(`${a.name ?? 'Someone'} created the Master GM account`);
    case 'gm.create_sub': return done(`${w} added Sub GM ${a.name}`);
    case 'gm.deactivate_sub': return done(`${w} removed Sub GM ${b.name}`);
    case 'gm.login': return done(`${w} signed in on a ${a.deviceType ?? 'device'}`);
    case 'gm.logout': return done(`${w} signed out`);
    case 'gm.device_type': return done(`${w} changed their device from ${b.deviceType} to ${a.deviceType}`);
    case 'gm.device_pause': return done(`${w} paused a GM device`);
    case 'gm.device_resume': return done(`${w} resumed a GM device`);
    case 'gm.pin_unlock': return done(`${w} unlocked a paused device with the PIN`);

    case 'night.create': return done(`${w} created the night “${a.name}” (${a.date}, ${a.length} min)`);
    case 'night.settings': return done(`${w} changed night settings`, diff(b, a));
    case 'night.update': return done(`${w} changed the night's name or length`, diff(b, a));
    case 'finale.skip': return done(`${w} skipped the finale`);
    case 'game.cancel_at_end': return done(`${w} ended the night with ${Array.isArray(a.games) ? a.games.length : 'some'} unfinished game(s): they were cancelled`);
    case 'gold.adjust': {
      const g = Number(a.goldH);
      return done(`${w} ${g >= 0 ? 'gave' : 'took'} ${gold(Math.abs(g))} gold ${g >= 0 ? 'to' : 'from'} ${player(a.playerId)}${a.reason ? ` (“${a.reason}”)` : ''}`);
    }
    case 'vote.open_early': return done(`${w} opened the quarter ${e.entityId} vote early`);

    case 'game.schedule': return done(`${w} scheduled ${a.name}${Array.isArray(a.participants) && a.participants.length ? ` for ${list(a.participants, player)}` : ''}`);
    case 'game.update': return done(`${w} edited ${game(e.entityId)}`, diff(b, a));
    case 'game.start': return done(`${w} started ${game(e.entityId)}${Array.isArray(a.participants) && a.participants.length ? ` with ${list(a.participants, player)}` : ''}`);
    case 'game.cancel': return done(`${w} cancelled ${game(e.entityId)}`);
    case 'game.result': return done(`${w} recorded the result of ${game(e.entityId)}: ${ranking(a)}${a.actualHours != null ? ` (${a.actualHours} h)` : ''}`);
    case 'game.correct': return done(`${w} corrected the result of ${game(e.entityId)}`, [`Before: ${ranking(b)}`, `After: ${ranking(a)}`]);
    case 'game.leader': return done(`${w} set the leader of ${game(e.entityId)} to ${player(a.leaderId)} (was ${b.leaderId ? player(b.leaderId) : 'nobody'})`);
    case 'game.scores': {
      const ids = Object.keys(a);
      return done(`${w} entered scores in ${game(e.entityId)}`, ids.map((id) => `${player(id)}: ${val(b[id])} → ${val(a[id])}`));
    }
    case 'board.edit': return done(`${w} edited the board in ${game(e.entityId)}`, diff(b, a));
    case 'board.settings': return done(`${w} changed the ${a.board} board settings`, Object.entries((a.values ?? {}) as Obj).map(([k, v]) => `${words(k)}: ${val(v)}`));
    case 'claim.approve':
    case 'claim.reject': return done(`${w} ${e.action === 'claim.approve' ? 'approved' : 'rejected'} a battle: ${player(a.attackerId)} took ${a.territories} territories from ${player(a.defenderId)}`);
    case 'reroll.log': return done(`${w} logged a re-roll for ${player(e.entityId)}${a.gameId ? ` in ${game(a.gameId)}` : ''}`);

    case 'table.create': return done(`${w} added the table “${a.name}” (${a.seats} seats)`);
    case 'table.update': return done(`${w} changed table ${table(e.entityId)}`, diff(b, a));
    case 'table.delete': return done(`${w} deleted the table “${b.name}”`);
    case 'seat.assign': return done(a.playerId == null ? `${w} emptied seat ${a.seat} at ${table(e.entityId)}` : `${w} seated ${player(a.playerId)} at seat ${a.seat} of ${table(e.entityId)}`);
    case 'seat.clear': return done(`${w} cleared every seat`);

    case 'market.offset': return done(`${w} set the price offset on ${stock(e.entityId)} to ${val(a.offset)} (was ${val(b.offset)})`);
    case 'handicap.offset': return done(`${w} set ${player(e.entityId)}'s handicap offset to ${val(a.offset)} (was ${val(b.offset)})`);
    case 'mood.record': return done(`${w} recorded a mood reading for ${player(e.entityId)}: mood ${a.mood}, self-assessment ${a.self}`);
    case 'hint.send': return done(`${w} sent ${player(e.entityId)} a ${a.tier} tip`);
    case 'notify.send': {
      const m = /^player:(\d+)$/.exec(String(a.target));
      return done(`${w} sent ${m ? player(m[1]) : 'everyone'} a notice: “${a.message}”`);
    }
    case 'espionage.create': return done(`${w} created an espionage memo for ${player(a.playerId)}`);
    case 'espionage.reassign': return done(`${w} reassigned an espionage memo to ${player(a.playerId)}`);
    case 'espionage.success': return done(`${w} marked ${player(a.playerId)}'s espionage assignment a success`);
    case 'espionage.fail': return done(`${w} marked ${player(a.playerId)}'s espionage assignment a failure`);
    case 'wiretap.use': return done(`${player(a.playerId)} used a wiretap`);

    case 'player.left': return done(`${w} marked ${player(e.entityId)} as left`);
    case 'player.returned': return done(`${w} marked ${player(e.entityId)} as back`);
    case 'player.ticker': return done(`${w} changed ${player(e.entityId)}'s ticker from ${b.ticker} to ${a.ticker}`);
    case 'device.approve': return done(`${w} approved a ${a.kind} request from ${player(a.playerId)}`);
    case 'device.deny': return done(`${w} denied a ${a.kind} request from ${player(a.playerId)}`);
    case 'device.auto_approve': return done(`${player(a.playerId)} was let back in automatically (same phone)`);

    case 'library.create': return done(`${w} added ${a.name} to the library`);
    case 'library.update': return done(`${w} edited ${a.name ?? names.library[String(e.entityId)] ?? 'a library game'}`, diff(b, a));
    case 'library.delete': return done(`${w} removed ${b.name} from the library`);
    case 'library.import': return done(e.gmName ? `${w} imported a game pack (${a.added} added, ${a.updated} updated)` : `The server loaded built-in games (${a.added} added, ${a.updated} updated)`);
    case 'library.repair_board': return done(`The server restored the board for ${list(a.repaired, String)}`);
    case 'rule.create': return done(`${w} added the rule “${a.title}”`);
    case 'rule.update': return done(`${w} edited the rule “${a.title ?? b.title}”`, b.title !== a.title ? [`title: ${val(b.title)} → ${val(a.title)}`] : []);
    case 'rule.delete': return done(`${w} deleted the rule “${b.title}”`);
    case 'sound.upload': return done(`${w} uploaded the sound “${a.name}”`);
    case 'sound.delete': return done(`${w} deleted the sound “${b.name}”`);
    default: {
      const m = /^night\.(\w+)$/.exec(e.action);
      if (m && nightVerb[m[1]!]) return done(`${w} ${nightVerb[m[1]!]}`);
      return done(`${w}: ${words(e.action.replace('.', ' '))}`, diff(b, a));
    }
  }
}
