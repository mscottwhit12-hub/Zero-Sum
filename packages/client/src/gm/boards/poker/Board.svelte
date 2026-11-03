<script lang="ts">
  /**
   * Texas Hold'em board: the GM's control panel and live tracker. Players around their table showing their chips;
   * a blind clock with a "blinds up" alert, a chip-count reminder (default every 30 minutes) and a "count round"
   * where the GM types in what everyone counted at the same moment (saved as a timestamped snapshot, drawn as a
   * chip-flow chart); buy-ins and rebuys in dollars; bust-outs (several at once = same hand, tied place); an optional
   * dealer button with the small and big blind seats; a pinnable crown, standings, recap and a timestamped history.
   * All rules live in ./def.ts; this file only draws and calls those operations.
   *
   * Edits are always built on the newest state this board has sent (`cur()`), not on the `state` prop, so a host that
   * saves with a delay can't make quick taps or "type a number, then tap +100" overwrite each other.
   */
  import Avatar from '../../../shared/Avatar.svelte';
  import type { BoardPlayer, BoardProps } from '../contract';
  import {
    NOTE_MAX,
    addNote,
    ackLevels,
    blindProblems,
    blindText,
    blindsFor,
    bust,
    bustBlock,
    buttonInfo,
    cfg,
    chipTotals,
    chips,
    clockInfo,
    clockText,
    countDue,
    describeEntry,
    isCash,
    levelCount,
    levelMs,
    mergeBust,
    nextHand,
    ordinal,
    paidDollars,
    parseChips,
    pauseClock,
    pl,
    rebuy,
    rebuyBlock,
    rebuysOf,
    recap,
    recordCount,
    removeCount,
    removeNote,
    restore,
    resumeClock,
    score,
    setButton,
    setLevel,
    setPin,
    setStack,
    snoozeCount,
    spanText,
    startClock,
    status,
    syncClock,
    syncPlayers,
    undoRebuy,
    zeroChipAlive,
    isGold,
    applyBlock,
    applyPlan,
    bankInfo,
    clearPayment,
    computePlan,
    dealBlock,
    effectiveCtx,
    planOutcome,
    syncStart,
    isPristine,
    payInfo,
    payMethods,
    payoutTable,
    planResolved,
    recordAllPayments,
    recordPayment,
    setPlan,
    units,
    worth,
    type PlanDraft,
    type PokerState,
  } from './def';
  import { COLOUR_NAMES, MAX_COLOURS, ladder, type ChipColour } from './chips';
  import { clamp, seatPoints } from './seating';

  let { ctx: baseCtx, state: game, onchange, onfinish }: BoardProps<PokerState> = $props();
  /** The context with this game's money settings (an accepted chip plan replaces the settings screen's). */
  const ctx = $derived(effectiveCtx(game, baseCtx));

  let picked = $state<number | null>(null);
  let rebuyAsk = $state<number | null>(null);
  let noteText = $state('');
  let noteAbout = $state('');
  let showAll = $state(false);
  let showRecap = $state(false);
  let showNumbers = $state(false);
  let removeAsk = $state<number | null>(null);
  /** Players being marked out who still have chips: asks who won them. */
  let winnerAsk = $state<{ pids: number[]; from: 'panel' | 'together' } | null>(null);
  let planAsk = $state(false);
  let planMsg = $state('');
  let showPay = $state(false);
  let counting = $state(false);
  /** Only the numbers the GM typed in the count form; every other box shows (and counts) the live stack. */
  let draft = $state<Record<number, string>>({});
  let countError = $state('');
  let countOpenedAt = $state(0);
  let discardAsk = $state(false);
  let countEl = $state<HTMLElement | null>(null);
  let bustSel = $state<number[]>([]);
  let bustNotice = $state('');
  /** Per-player message when a move isn't allowed or a typed number can't be used. */
  let notice = $state<Record<number, string>>({});
  let RW = $state(0);
  const wide = $derived(RW >= 900);
  let W = $state(0);

  /** Ticks once a second so the countdown and the reminders stay live. */
  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (nowMs = Date.now()), 1000);
    return () => clearInterval(id);
  });

  // ---- sending edits: always build on the newest state we have sent (plain variables, not reactive)
  let pending: PokerState | null = null;
  let emitted: string[] = [];
  const cur = (): PokerState => pending ?? game;
  const apply = (next: PokerState) => {
    if (next === cur()) return;
    pending = next;
    emitted.push(JSON.stringify(next));
    onchange(next);
  };
  /** When the host hands a state back: drop what it has caught up on; anything we didn't send means someone else edited. */
  $effect.pre(() => {
    const g = game;
    notice = {};
    bustNotice = '';
    if (pending === null) return;
    const i = emitted.indexOf(JSON.stringify(g));
    if (i === -1) {
      pending = null;
      emitted = [];
      return;
    }
    emitted = emitted.slice(i + 1);
    if (!emitted.length) pending = null;
  });
  /** Keeps the saved state in step with the table: late joiners, a changed level length, a shorter blind schedule. */
  $effect(() => {
    const t = Date.now();
    apply(syncStart(syncClock(syncPlayers(cur(), ctx, t), ctx, t), ctx));
  });

  const now = () => Date.now();
  const nameOf = (id: number) => ctx.players.find((p) => p.id === id)?.name ?? 'Another player';
  const first = (n: string) => n.split(/\s+/)[0] ?? n;
  const say = (pid: number, msg: string) => {
    if ((notice[pid] ?? '') !== msg) notice = { ...notice, [pid]: msg };
  };

  // ---- derived
  const cash = $derived(isCash(ctx.settings));
  const sel = $derived(picked !== null && ctx.players.some((p) => p.id === picked) ? picked : (ctx.players[0]?.id ?? null));
  const selPlayer = $derived(ctx.players.find((p) => p.id === sel) ?? null);
  const stat = $derived(status(game, ctx));
  const standings = $derived(recap(game, ctx));
  const totals = $derived(chipTotals(game, ctx));
  const clock = $derived(clockInfo(game, ctx, nowMs));
  const blinds = $derived(blindsFor(clock.level, ctx.settings));
  const lastLevel = $derived(levelCount(ctx.settings));
  const nextBlinds = $derived(clock.level < lastLevel ? blindsFor(clock.level + 1, ctx.settings) : null);
  const blindWarn = $derived(blindProblems(ctx.settings));
  const due = $derived(countDue(game, ctx, nowMs));
  const rebuyUntil = $derived(Math.floor(cfg(ctx.settings, 'rebuyUntilLevel')));
  const rebuysOn = $derived(Math.floor(cfg(ctx.settings, 'maxRebuys')) > 0);
  const rebuysOpen = $derived(rebuysOn && clock.level <= rebuyUntil);
  const rebuyText = $derived(!rebuysOn ? 'Rebuys off' : !rebuysOpen ? 'Rebuys closed' : cash ? 'Rebuys open' : `Rebuys open through level ${rebuyUntil}`);
  const trackButton = $derived(cfg(ctx.settings, 'trackButton') >= 1);
  // money: collecting buy-ins, the chip plan, the bank and what everyone receives
  const gold = $derived(isGold(ctx.settings));
  const ppu = $derived(Math.max(1, cfg(ctx.settings, 'pointsPerUnit')));
  const unit = (n: number) => units(n, ctx.settings);
  const pts = (n: number) => worth(n, ctx.settings);
  const buyInNow = $derived(cfg(ctx.settings, 'buyIn'));
  const payNeeded = $derived(cfg(ctx.settings, 'requirePayment') >= 1);
  const pay = $derived(payInfo(game, ctx));
  const payBy = $derived(Object.fromEntries(pay.rows.map((r) => [r.playerId, r])));
  const payRowsShown = $derived(game.button === null || showPay ? pay.rows : pay.rows.filter((r) => r.short > 0));
  const dealWhy = $derived(dealBlock(game, ctx));
  const methods = $derived(payMethods(ctx.settings));
  const pristine = $derived(isPristine(game));
  const plan = $derived(computePlan(game, ctx));
  const planIn = $derived(planResolved(game, ctx));
  const planWhy = $derived(applyBlock(game, ctx));
  const planSettings = $derived({ ...ctx.settings, currency: planIn.currency });
  const planWorth = (n: number) => worth(n, planSettings);
  const planUnit = (n: number) => units(n, planSettings);
  const planCols = $derived(game.plan?.colours ?? []);
  const suggested = $derived(ladder(Math.max(1, planCols.filter((c) => c.count > 0).length), Math.max(1, Math.round(planIn.buyIn * ppu))));
  const bank = $derived(bankInfo(game, ctx));
  const cashOut = $derived(payoutTable(game, ctx));
  const stackPts = $derived(cfg(ctx.settings, 'startStack'));
  const stackMismatch = $derived(!game.applied && Math.abs(stackPts / ppu - buyInNow) > 1e-9);
  /** What accepting the plan would set (null = it can't be accepted yet). */
  const outcome = $derived(planOutcome(game, ctx));
  const planBuyIn = $derived(outcome?.buyIn ?? planIn.buyIn);
  const chipsTyped = $derived(planCols.some((c) => c.count > 0));
  const planMatches = $derived(!!game.applied && !!outcome && game.applied.startStack === outcome.stack && game.applied.buyIn === outcome.buyIn && game.applied.currency === outcome.currency);
  /** True while the GM has typed a plan (chips, a buy-in or a currency) that isn't accepted yet: money shouldn't be collected on a plan that may still change. */
  const planPending = $derived(
    pristine &&
      !planMatches &&
      !!game.plan &&
      (chipsTyped || (game.plan.currency != null && game.plan.currency !== cfg(ctx.settings, 'currency')) || (game.plan.buyIn != null && game.plan.buyIn !== buyInNow)),
  );
  const btn = $derived(trackButton ? buttonInfo(game, ctx) : null);
  const active = $derived(ctx.players.filter((o) => !pl(game, o.id, ctx).out));
  const outPlayers = $derived(ctx.players.filter((o) => pl(game, o.id, ctx).out));
  const zero = $derived(zeroChipAlive(game, ctx));
  const entries = $derived([...game.log].sort((a, b) => b.t - a.t || b.id - a.id));
  const shownEntries = $derived(showAll ? entries : entries.slice(0, 30));
  const scores = $derived(score(game, ctx));
  const crownId = $derived.by(() => {
    let best: number | null = null;
    for (const p of ctx.players) if (best === null || (scores[p.id] ?? 0) > (scores[best] ?? 0)) best = p.id;
    return best;
  });
  const stackOf = (id: number) => (pl(game, id, ctx).out ? 0 : pl(game, id, ctx).stack);
  const lastSnapT = $derived(game.snaps[game.snaps.length - 1]?.t ?? 0);
  const freshBust = $derived(outPlayers.some((o) => (pl(game, o.id, ctx).outAt ?? 0) > lastSnapT));
  const bustPick = $derived(bustSel.filter((id) => active.some((o) => o.id === id)));
  const SMALL = $derived(Math.max(1, Math.round(cfg(ctx.settings, 'stepSmall'))));
  const BIG = $derived(Math.max(1, Math.round(cfg(ctx.settings, 'stepBig'))));

  /** Short names for the table; players who share a first name get a last initial (or a number). */
  const labelOf = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const p of ctx.players) counts.set(first(p.name), (counts.get(first(p.name)) ?? 0) + 1);
    const used = new Set<string>();
    const out: Record<number, string> = {};
    ctx.players.forEach((p, i) => {
      const f = first(p.name);
      const rest = p.name.split(/\s+/).slice(1).join(' ');
      let cand = (counts.get(f) ?? 0) < 2 ? f : rest ? `${f} ${rest[0]}.` : f;
      if (used.has(cand)) cand = `${cand} ${i + 1}`;
      used.add(cand);
      out[p.id] = cand;
    });
    return out;
  });

  // ---- count form
  const draftText = (id: number) => draft[id] ?? chips(stackOf(id));
  const badDraft = $derived(active.filter((o) => o.id in draft && parseChips(draft[o.id]!) === null));
  const draftSum = $derived(active.reduce((n, o) => n + (o.id in draft ? (parseChips(draft[o.id]!) ?? 0) : stackOf(o.id)), 0));
  const typedCount = $derived(Object.keys(draft).length);

  /** Seat number -> player (first claim wins); everyone else (no seat, no table, shared seat) goes in `rest`. */
  const seating = $derived.by(() => {
    const bySeat = new Map<number, BoardPlayer>();
    const rest: BoardPlayer[] = [];
    const t = ctx.table;
    for (const p of ctx.players) {
      if (t && p.seat !== null && p.seat >= 1 && p.seat <= t.seats && !bySeat.has(p.seat)) bySeat.set(p.seat, p);
      else rest.push(p);
    }
    return { bySeat, rest };
  });

  // ---- table drawing (geometry as in the TV table view)
  const H = $derived(W / 1.25);
  const S = $derived(Math.round(clamp(W * 0.12, 44, 56)));
  const FS = 12;
  const fit = $derived.by(() => {
    const t = ctx.table;
    if (!t) return { tw: 0, th: 0 };
    const mx = S * 1.5 + 4;
    const my = S + FS * 2.6 + 8;
    const aspect = t.w / t.h;
    const tw = Math.min(Math.max(40, W - 2 * mx), Math.max(30, H - 2 * my) * aspect);
    return { tw, th: tw / aspect };
  });
  const seatPts = $derived(ctx.table && W > 0 ? seatPoints(ctx.table.seats, fit.tw, fit.th, S, 6) : []);
  /** Closest two seats: top and bottom names are cut to this width so neighbours never run into each other. */
  const topW = $derived.by(() => {
    let m = Infinity;
    for (let i = 0; i < seatPts.length; i++) for (let j = i + 1; j < seatPts.length; j++) m = Math.min(m, Math.hypot(seatPts[i]!.x - seatPts[j]!.x, seatPts[i]!.y - seatPts[j]!.y));
    return Math.max(36, Math.floor(m === Infinity ? S * 2 : m) - 2);
  });
  const sideW = $derived(Math.round(S * 1.15));
  /** Which side of the table a seat sits on: names go above/below top and bottom seats, and over the table beside side seats. */
  const kindOf = (x: number, y: number): string => (Math.abs(x) > fit.tw / 2 ? `${x > 0 ? 'r' : 'l'} ${y < -1 ? 'up' : y > 1 ? 'dn' : 'mid'}` : y < 0 ? 'top' : 'bot');
  const isSide = (kind: string) => kind.startsWith('l ') || kind.startsWith('r ');

  // ---- chip-flow chart (one line per player through every count round; a bust drops the line to 0)
  const PALETTE = ['var(--accent)', 'var(--good)', 'var(--text)', 'var(--muted)'];
  const DASHES = ['', '6 3', '2 3'];
  const chart = $derived.by(() => {
    const snaps = game.snaps;
    if (!snaps.length) return null;
    const firstSnap = snaps[0]!.t;
    const t0 = Math.min(ctx.startedAt ?? firstSnap, firstSnap);
    let t1 = snaps[snaps.length - 1]!.t;
    for (const p of ctx.players) {
      const d = pl(game, p.id, ctx);
      if (d.out && d.outAt !== null) t1 = Math.max(t1, d.outAt);
    }
    const span = Math.max(1, t1 - t0);
    const cw = 320;
    const ch = 170;
    const padL = 8;
    const padR = 8;
    const padT = 14;
    const padB = 22;
    let maxV = 1;
    const raw = ctx.players.map((p) => {
      const d = pl(game, p.id, ctx);
      const endT = d.out && d.outAt !== null ? d.outAt : Infinity;
      const pts = [{ t: t0, v: d.buys[0]?.chips ?? 0 }, ...snaps.filter((sn) => sn.t <= endT).map((sn) => ({ t: sn.t, v: sn.stacks[p.id] ?? 0 }))];
      if (d.out && d.outAt !== null) pts.push({ t: d.outAt, v: 0 });
      for (const pt of pts) maxV = Math.max(maxV, pt.v);
      return { p, pts };
    });
    const lines = raw.map(({ p, pts }, idx) => ({
      id: p.id,
      name: labelOf[p.id] ?? p.name,
      color: p.color ?? PALETTE[idx % PALETTE.length]!,
      dash: p.color ? '' : DASHES[Math.floor(idx / PALETTE.length) % DASHES.length]!,
      points: pts
        .map((pt) => `${(padL + ((clamp(pt.t, t0, t1) - t0) / span) * (cw - padL - padR)).toFixed(1)},${(padT + (1 - pt.v / maxV) * (ch - padT - padB)).toFixed(1)}`)
        .join(' '),
    }));
    return { lines, maxV, cw, ch, padL, padR, padT, padB, spanMs: t1 - t0 };
  });

  // ---- actions
  const pick = (id: number) => {
    picked = id;
    rebuyAsk = null;
    if (wide) document.getElementById(`poker-p-${id}`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  };

  /** Sets a player's chips from a typed or stepped number, refusing numbers that can't be right. */
  function setChips(pid: number, v: number) {
    const s = cur();
    const max = cfg(ctx.settings, 'chipMax');
    const inPlay = chipTotals(s, ctx).boughtIn;
    if (v > max) return say(pid, `That is over the chip limit (${chips(max)}).`);
    if (v > inPlay) return say(pid, `That is more than all the chips in play (${chips(inPlay)}). Check the number.`);
    say(pid, '');
    apply(setStack(s, ctx, pid, v, now()));
  }
  function stepBy(pid: number, delta: number) {
    const s = cur();
    const have = pl(s, pid, ctx).stack;
    const v = Math.max(0, have + delta);
    if (v !== have) setChips(pid, v);
  }
  function commitChips(e: Event, pid: number) {
    const input = e.currentTarget as HTMLInputElement;
    const raw = input.value;
    input.value = chips(pl(cur(), pid, ctx).stack);
    const v = parseChips(raw);
    if (v === null) return say(pid, `Couldn\u2019t read \u201c${raw.slice(0, 20)}\u201d. Type whole chips, like 5,000 or 5k.`);
    setChips(pid, v);
  }

  async function openCount() {
    draft = {};
    countError = '';
    discardAsk = false;
    countOpenedAt = Date.now();
    counting = true;
    await new Promise((r) => setTimeout(r, 0));
    countEl?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }
  function saveCount() {
    if (badDraft.length) {
      countError = `Fix the number for ${badDraft.map((o) => o.name).join(', ')}.`;
      return;
    }
    const s = cur();
    const max = cfg(ctx.settings, 'chipMax');
    const inPlay = chipTotals(s, ctx).boughtIn;
    const values: Record<number, number> = {};
    for (const o of active) {
      if (!(o.id in draft)) continue;
      const v = parseChips(draft[o.id]!)!;
      if (v > max) {
        countError = `${o.name}: over the chip limit (${chips(max)}).`;
        return;
      }
      if (v > inPlay) {
        countError = `${o.name}: more than all the chips in play (${chips(inPlay)}).`;
        return;
      }
      values[o.id] = v;
    }
    countError = '';
    apply(recordCount(s, ctx, values, countOpenedAt));
    counting = false;
    draft = {};
    discardAsk = false;
  }
  function cancelCount() {
    if (typedCount && !discardAsk) {
      discardAsk = true;
      return;
    }
    counting = false;
    draft = {};
    countError = '';
    discardAsk = false;
  }
  /** Enter moves to the next box; on the last box it saves. */
  function countKey(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const boxes = [...(countEl?.querySelectorAll<HTMLInputElement>('.countrow input') ?? [])];
    const next = boxes[boxes.indexOf(e.currentTarget as HTMLInputElement) + 1];
    if (next) {
      next.focus();
      next.select();
    } else saveCount();
  }

  function doRebuy(pid: number, confirmed = false) {
    const s = cur();
    const why = rebuyBlock(s, ctx, pid, now());
    if (why) return say(pid, why);
    const d = pl(s, pid, ctx);
    if (!confirmed && !d.out && d.stack >= cfg(ctx.settings, 'startStack')) {
      rebuyAsk = pid;
      return;
    }
    rebuyAsk = null;
    apply(rebuy(s, ctx, pid, now()));
  }

  const toggleBust = (id: number) => {
    bustNotice = '';
    bustSel = bustSel.includes(id) ? bustSel.filter((x) => x !== id) : [...bustSel, id];
  };
  const chipsOf = (ids: number[]) => ids.reduce((n, id) => n + pl(cur(), id, ctx).stack, 0);
  function doBustSelected() {
    const s = cur();
    const why = bustBlock(s, ctx, bustPick);
    if (why) {
      bustNotice = why;
      return;
    }
    if (chipsOf(bustPick) > 0) {
      winnerAsk = { pids: [...bustPick], from: 'together' };
      return;
    }
    apply(bust(s, ctx, bustPick, now()));
    bustSel = [];
  }
  /** One tap marks a player with no chips out; a player with chips asks who won them, then one more tap finishes it. */
  function doBust(pid: number) {
    const s = cur();
    const why = bustBlock(s, ctx, [pid]);
    if (why) return say(pid, why);
    if (pl(s, pid, ctx).stack > 0) {
      winnerAsk = { pids: [pid], from: 'panel' };
      return;
    }
    bustSel = bustSel.filter((x) => x !== pid);
    apply(bust(s, ctx, [pid], now()));
  }
  /** Finishes a bust-out: the chips go to `winnerId`, or nowhere (null) when the GM will update the stacks by hand. */
  function chooseWinner(winnerId: number | null) {
    const a = winnerAsk;
    if (!a) return;
    const s = cur();
    const why = bustBlock(s, ctx, a.pids, winnerId);
    if (why) {
      if (a.from === 'panel') say(a.pids[0]!, why);
      else bustNotice = why;
      return;
    }
    winnerAsk = null;
    bustSel = bustSel.filter((x) => !a.pids.includes(x));
    apply(bust(s, ctx, a.pids, now(), winnerId));
  }

  // ---- money
  const payWith = (pid: number, how: 'cash' | 'venmo' | 'gold') => apply(recordPayment(cur(), ctx, pid, how, now()));
  const payAll = (how: 'cash' | 'venmo' | 'gold') => apply(recordAllPayments(cur(), ctx, how, now()));
  const unpay = (pid: number) => apply(clearPayment(cur(), ctx, pid, now()));
  const howLabel = (how: string | null) => (how === 'gold' ? 'Gold held' : how === 'venmo' ? 'Venmo' : how === 'cash' ? 'Cash' : '');
  const inLabel = (how: string) => (how === 'gold' ? 'Gold held' : how === 'venmo' ? 'Venmo in' : 'Cash in');

  /** "20", "$20", "12.50", "20 gold" -> a number of dollars or gold; anything else null. */
  const parseUnits = (txt: string): number | null => {
    const n = Number(txt.trim().toLowerCase().replace(/gold|\$|,|\s/g, ''));
    return txt.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
  };
  function planPatch(patch: Partial<PlanDraft>) {
    planMsg = '';
    planAsk = false;
    apply(setPlan(cur(), ctx, patch));
  }
  const colours = (): ChipColour[] => [...(cur().plan?.colours ?? [])];
  function setColour(i: number, patch: Partial<ChipColour>) {
    const cols = colours();
    cols[i] = { ...cols[i]!, ...patch };
    planPatch({ colours: cols });
  }
  function addColour() {
    const cols = colours();
    if (cols.length >= MAX_COLOURS) return;
    const used = new Set(cols.map((c) => c.name.toLowerCase()));
    cols.push({ name: COLOUR_NAMES.find((n) => !used.has(n)) ?? `colour ${cols.length + 1}`, count: 0, value: null });
    planPatch({ colours: cols });
  }
  function dropColour(i: number) {
    planPatch({ colours: colours().filter((_, j) => j !== i) });
  }
  function moveColour(i: number, d: number) {
    const cols = colours();
    const j = i + d;
    if (j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j]!, cols[i]!];
    planPatch({ colours: cols });
  }
  /** Reads a typed number of chips for a colour; says so when it can't. */
  function commitCount(e: Event, i: number) {
    const input = e.currentTarget as HTMLInputElement;
    const raw = input.value.trim();
    const v = raw === '' ? 0 : parseChips(raw);
    if (v === null) {
      planMsg = `Couldn\u2019t read \u201c${raw.slice(0, 20)}\u201d as a number of chips.`;
      input.value = String(colours()[i]?.count || '');
      return;
    }
    setColour(i, { count: v });
  }
  function commitValue(e: Event, i: number) {
    const input = e.currentTarget as HTMLInputElement;
    const raw = input.value.trim();
    if (raw === '') return setColour(i, { value: null });
    const v = parseUnits(raw);
    if (v === null) {
      planMsg = `Couldn\u2019t read \u201c${raw.slice(0, 20)}\u201d as a chip value. Type it in ${planIn.currency ? 'gold' : 'dollars'}, like 0.25.`;
      const cur0 = colours()[i]?.value;
      input.value = cur0 ? String(Math.round((cur0 / ppu) * 100) / 100) : '';
      return;
    }
    setColour(i, { value: Math.round(v * ppu) });
  }
  function commitBuyIn(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const v = parseUnits(input.value);
    if (v === null) {
      planMsg = `Couldn\u2019t read \u201c${input.value.slice(0, 20)}\u201d as a buy-in.`;
      input.value = String(planIn.buyIn);
      return;
    }
    planPatch({ buyIn: v });
  }
  function commitPlayers(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const v = parseChips(input.value);
    if (v === null || v < 1) {
      planMsg = 'Players has to be a whole number, 1 or more.';
      input.value = String(planIn.players);
      return;
    }
    planPatch({ players: v });
  }
  function commitShare(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const n = Number(input.value.replace('%', '').trim());
    if (!Number.isFinite(n) || n < 10 || n > 100) {
      planMsg = 'The share to players has to be between 10% and 100%.';
      input.value = String(Math.round(planIn.sharePercent * 10) / 10);
      return;
    }
    planPatch({ sharePercent: n });
  }
  function acceptPlan() {
    planAsk = false;
    apply(applyPlan(cur(), ctx, now()));
  }
  const valText = (v: number | null) => (v ? String(Math.round((v / ppu) * 100) / 100) : '');

  const submitNote = () => {
    if (!noteText.trim()) return;
    apply(addNote(cur(), ctx, noteText, noteAbout === '' ? null : Number(noteAbout), now()));
    noteText = '';
  };
  const removeSnap = (id: number) => {
    if (removeAsk !== id) {
      removeAsk = id;
      return;
    }
    removeAsk = null;
    apply(removeCount(cur(), ctx, id, now()));
  };

  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const clockTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  /** "10k" for big step buttons so they fit on a phone. */
  const short = (n: number) => (n >= 1000000 && n % 1000000 === 0 ? `${n / 1000000}M` : n >= 10000 && n % 1000 === 0 ? `${n / 1000}k` : chips(n));
</script>

{#snippet stepper(pid: number, label: string, value: number)}
  <div class="field stepfield">
    <span class="small muted">{label}</span>
    <input class="mono num" type="text" inputmode="numeric" enterkeyhint="done" value={chips(value)} aria-label={`${label} for ${nameOf(pid)}`} onchange={(e) => commitChips(e, pid)} />
    <div class="steps">
      <button onclick={() => stepBy(pid, -BIG)} aria-label={`minus ${chips(BIG)}`}>−{short(BIG)}</button>
      <button onclick={() => stepBy(pid, -SMALL)} aria-label={`minus ${chips(SMALL)}`}>−{short(SMALL)}</button>
      <button onclick={() => stepBy(pid, SMALL)} aria-label={`plus ${chips(SMALL)}`}>+{short(SMALL)}</button>
      <button onclick={() => stepBy(pid, BIG)} aria-label={`plus ${chips(BIG)}`}>+{short(BIG)}</button>
    </div>
  </div>
{/snippet}

<!-- D / SB / BB markers for a player -->
{#snippet tags(id: number)}
  {#if btn}
    {#if btn.dealer === id}<span class="tag d" title="Dealer">D</span>{/if}
    {#if btn.sb === id}<span class="tag sb" title="Small blind">SB</span>{/if}
    {#if btn.bb === id}<span class="tag bb" title="Big blind">BB</span>{/if}
  {/if}
{/snippet}

<!-- asks who won the chips of players who are going out -->
{#snippet winnerPicker(pids: number[])}
  {@const total = pids.reduce((n, id) => n + stackOf(id), 0)}
  <div class="ask">
    <p><strong>Who won {pids.map((id) => labelOf[id]).join(' and ')}’s {chips(total)} chips?</strong></p>
    <div class="row">
      {#each active.filter((o) => !pids.includes(o.id)) as o (o.id)}
        <button class="big" disabled={!!bustBlock(game, ctx, pids, o.id)} onclick={() => chooseWinner(o.id)}>{labelOf[o.id]}</button>
      {/each}
    </div>
    <div class="row">
      <button class="link" onclick={() => chooseWinner(null)}>Someone else: I’ll update the stacks myself</button>
      <button class="link" onclick={() => (winnerAsk = null)}>Cancel</button>
    </div>
  </div>
{/snippet}

{#snippet playerPanel(p: BoardPlayer)}
  {@const d = pl(game, p.id, ctx)}
  {@const why = rebuyBlock(game, ctx, p.id, nowMs)}
  {@const pr = payBy[p.id]}
  <section class="panel pp" class:cur={p.id === sel} id={`poker-p-${p.id}`}>
    <div class="spread">
      <div class="row">
        <Avatar name={p.name} color={p.color} src={p.avatarPath} size={36} />
        <h2>{p.name}</h2>
        {@render tags(p.id)}
        {#if crownId === p.id && !d.out}<span class="small" title="Wears the crown">👑</span>{/if}
      </div>
      <span class="badge" class:live={!d.out}>{d.out ? 'Out' : `${chips(d.stack)} chips · ${pts(d.stack)}`}</span>
    </div>

    {#if d.out}
      <p>
        Out of the game.
        {#if d.outAt !== null}<span class="muted small">{time(d.outAt)}</span>{/if}
      </p>
      <div class="row">
        <button class="big" onclick={() => apply(restore(cur(), ctx, p.id, now()))}>Undo bust-out</button>
        {#if rebuysOn}<button class="big" disabled={!!why} onclick={() => doRebuy(p.id)}>Rebuy ({unit(buyInNow)})</button>{/if}
      </div>
      {#if rebuysOn && why}<p class="small muted">{why}</p>{/if}
      {#if notice[p.id]}<p class="error">{notice[p.id]}</p>{/if}
      {#if !cash && outPlayers.length > 1}
        <div class="field">
          <span class="small muted">Went out on the same hand as…</span>
          <select class="sel" aria-label={`Same hand as, for ${p.name}`} onchange={(e) => { apply(mergeBust(cur(), ctx, p.id, Number(e.currentTarget.value), now())); e.currentTarget.value = ''; }}>
            <option value="">Choose…</option>
            {#each outPlayers.filter((o) => o.id !== p.id && pl(game, o.id, ctx).outGroup !== d.outGroup) as o (o.id)}<option value={String(o.id)}>{labelOf[o.id]}</option>{/each}
          </select>
        </div>
      {/if}
    {:else}
      {@render stepper(p.id, 'Chips', d.stack)}
      {#if notice[p.id]}<p class="error">{notice[p.id]}</p>{/if}

      <div class="field">
        <div class="spread">
          <span class="small">Bought in <strong class="mono">{unit(paidDollars(d))}</strong>{rebuysOf(d) ? ` · ${rebuysOf(d)} rebuy${rebuysOf(d) === 1 ? '' : 's'}` : ''}</span>
          <div class="row">
            {#if rebuysOn}<button class="big" disabled={!!why} onclick={() => doRebuy(p.id)}>Rebuy ({unit(buyInNow)})</button>{/if}
            {#if rebuysOf(d) > 0}<button class="link" onclick={() => apply(undoRebuy(cur(), ctx, p.id, now()))}>Undo last rebuy</button>{/if}
          </div>
        </div>
        {#if rebuysOn && why}<p class="small muted">{why}</p>{/if}
        {#if pr && pr.short > 0 && game.button !== null}
          <div class="field">
            <span class="small"><strong>To collect {unit(pr.short)}</strong> from {labelOf[p.id]}</span>
            <div class="row">
              {#each methods as how (how)}<button class="big" onclick={() => payWith(p.id, how)}>{inLabel(how)}</button>{/each}
            </div>
          </div>
        {/if}
        {#if rebuyAsk === p.id}
          <div class="ask">
            <p><strong>{p.name} still has {chips(d.stack)} chips.</strong> Rebuy {unit(buyInNow)} for {chips(cfg(ctx.settings, 'rebuyChips'))} more chips?</p>
            <div class="row">
              <button class="big primary" onclick={() => doRebuy(p.id, true)}>Yes, rebuy</button>
              <button class="big" onclick={() => (rebuyAsk = null)}>Cancel</button>
            </div>
          </div>
        {/if}
      </div>

      <div class="row">
        {#if trackButton}<button onclick={() => apply(setButton(cur(), ctx, p.id))} disabled={btn?.dealer === p.id}>Make dealer</button>{/if}
        {#if game.pin === p.id}
          <button onclick={() => apply(setPin(cur(), ctx, null, now()))}>Unpin crown</button>
        {:else}
          <button onclick={() => apply(setPin(cur(), ctx, p.id, now()))}>Pin crown here</button>
        {/if}
      </div>

      {#if winnerAsk && winnerAsk.from === 'panel' && winnerAsk.pids[0] === p.id}
        {@render winnerPicker(winnerAsk.pids)}
      {:else}
        <button class="big danger" disabled={stat.alive.length <= 1} onclick={() => doBust(p.id)}>Mark {labelOf[p.id]} out</button>
      {/if}
    {/if}
  </section>
{/snippet}

<div class="pokerhost" bind:clientWidth={RW}>
<div class="poker" class:wide>
<div class="left">
  <section class="panel">
    <div class="spread">
      <div class="row">
        <span class="badge">{cash ? 'Cash game' : 'Tournament'}</span>
        <span class="badge">{stat.alive.length} of {ctx.players.length} still in</span>
        {#if crownId !== null}<span class="badge">👑 {labelOf[crownId]}{game.pin !== null && game.pin === crownId ? ' (pinned)' : ''}</span>{/if}
        {#if !stat.over}
          <button onclick={() => (showRecap = !showRecap)}>{showRecap ? 'Hide recap' : 'Recap'}</button>
        {/if}
      </div>
    </div>
    {#if stat.over && stat.winnerId !== null}
      <p class="win">
        <strong>{nameOf(stat.winnerId)} has all the chips.</strong>
        {#if onfinish}Finish the game; the places are filled in for you.{/if}
      </p>
      {#if onfinish}<button class="big primary" onclick={() => onfinish?.()}>Open the result screen</button>{/if}
    {:else if onfinish}
      <div class="calltime">
        <button class="big" onclick={() => onfinish?.()}>Call time and finish</button>
        <span class="small muted">{cash ? 'Ranks everyone by chips.' : 'Players still in are ranked by chips, above everyone already out.'}</span>
      </div>
    {/if}
  </section>

  {#if clock.newLevel}
    <section class="panel alert" role="alert">
      <div class="spread">
        <strong>Blinds up! Level {clock.level}: {blindText(blinds)}</strong>
        <button class="big primary" onclick={() => apply(ackLevels(cur(), ctx, now()))}>Got it</button>
      </div>
    </section>
  {/if}

  {#if due.due && !counting}
    <section class="panel alert" role="alert">
      <div class="spread">
        <strong>Time for a chip count</strong>
        <div class="row">
          <button class="big primary" onclick={openCount}>Count now</button>
          <button class="big" onclick={() => apply(snoozeCount(cur(), now()))}>Later</button>
        </div>
      </div>
      <p class="small muted">Everyone counts at the same moment; you type the numbers in.</p>
    </section>
  {/if}

  {#if zero.length}
    <section class="panel alert" role="alert">
      <strong>{zero.length === 1 ? `${labelOf[zero[0]!]} has` : `${zero.map((id) => labelOf[id]).join(', ')} have`} 0 chips but {zero.length === 1 ? 'isn\u2019t' : 'aren\u2019t'} marked out.</strong>
      <p class="small muted">Set their chips, or mark them out so the game can finish.</p>
      <div class="row">
        {#each zero as id (id)}<button class="big danger" disabled={stat.alive.length <= 1} onclick={() => doBust(id)}>Mark {labelOf[id]} out</button>{/each}
      </div>
    </section>
  {/if}

  <section class="panel">
    <h3>Blinds</h3>
    {#each blindWarn.slice(0, 3) as w (w)}<p class="warnline">⚠ {w} Check the settings.</p>{/each}
    {#if !clock.started && !cash}
      <p>The blind clock hasn’t started.</p>
      <button class="big primary" onclick={() => apply(startClock(cur(), ctx, now()))}>Start the blind clock</button>
    {:else}
      <div class="spread">
        <div>
          <div class="small muted">Level {clock.level} of {lastLevel}</div>
          <div class="blinds mono">{blindText(blinds)}</div>
          <div class="small muted">{pts(blinds.sb)} / {pts(blinds.bb)}{blinds.ante > 0 ? `, ante ${pts(blinds.ante)}` : ''} (points are {gold ? 'hundredths of a gold' : 'cents'})</div>
        </div>
        {#if clock.remainingMs !== null}
          <div class="clockbox">
            {#if clock.paused}<span class="badge">Paused</span>{/if}
            <div class="countdown mono" class:low={clock.remainingMs < 60000 && !clock.paused} class:paused={clock.paused}>{clockText(clock.remainingMs)}</div>
          </div>
        {:else}
          <div class="small muted">{cash ? 'Blinds stay put' : 'Last level'}</div>
        {/if}
      </div>
      <p class="small muted">
        {#if nextBlinds}Next: {blindText(nextBlinds)} ({pts(nextBlinds.sb)} / {pts(nextBlinds.bb)}){:else}No higher level.{/if}
        · {rebuyText}
      </p>
      <div class="row">
        {#if !cash}
          {#if clock.paused}
            <button class="big primary" onclick={() => apply(resumeClock(cur(), ctx, now()))}>Resume</button>
          {:else}
            <button class="big" onclick={() => apply(pauseClock(cur(), ctx, now()))}>Pause</button>
          {/if}
        {/if}
        <button class="big" disabled={clock.level <= 1} onclick={() => apply(setLevel(cur(), ctx, clock.level - 1, now()))}>Level down</button>
        <button class="big" disabled={clock.level >= lastLevel} onclick={() => apply(setLevel(cur(), ctx, clock.level + 1, now()))}>Level up</button>
      </div>
    {/if}
    {#if trackButton}
      <div class="field">
        <div class="spread">
          <span class="small">
            {#if btn}
              Hand {game.hand}{btn.headsUp ? ' (heads-up)' : ''}:
              {#if btn.headsUp}
                <strong>{labelOf[btn.dealer]}</strong> deals and posts the {btn.dealer === btn.sb ? 'small' : 'big'} blind; <strong>{labelOf[btn.dealer === btn.sb ? btn.bb : btn.sb]}</strong> posts the {btn.dealer === btn.sb ? 'big' : 'small'} blind
              {:else}
                dealer <strong>{labelOf[btn.dealer]}</strong>, small blind <strong>{labelOf[btn.sb]}</strong>, big blind <strong>{labelOf[btn.bb]}</strong>
              {/if}
            {:else if game.button === null}
              Dealer button not set yet.
            {:else}
              Not enough players left for blinds.
            {/if}
          </span>
          <button class="big" disabled={stat.alive.length < 2 || (game.button === null && !!dealWhy)} onclick={() => apply(nextHand(cur(), ctx))}>{game.button === null ? 'Deal first hand' : 'Next hand'}</button>
        </div>
        {#if game.button === null && dealWhy}<p class="warnline">⚠ {dealWhy}</p>{/if}
      </div>
    {/if}
  </section>

  {#if ctx.players.length === 0}
    <section class="panel"><p class="muted">No players in this game yet. Add players first, then set up the chips here.</p></section>
  {/if}

  {#if payNeeded || pay.toCollect > 0}
    <section class="panel" id="poker-money">
      <div class="spread">
        <h3>Buy-ins</h3>
        <span class="badge">{pay.rows.filter((r) => r.short === 0).length} of {pay.rows.length} paid</span>
      </div>
      {#if pay.toCollect === 0 && !showPay}
        <p class="small">✓ Every buy-in is in: {unit(pay.got)} {gold ? 'in gold held' : 'collected'}. <button class="link" onclick={() => (showPay = true)}>Details</button></p>
      {:else}
        {#if planPending}
          <p class="warnline">⚠ Accept the chip plan below before collecting: the buy-in or currency may still change.</p>
        {/if}
        {#if game.button === null}
          <p class="small muted">
            {#if gold}Gold game: tapping “Gold held” takes the buy-in out of that player’s cash and holds it (it still counts in their net worth). At the result the pot is paid out by chip value; cancelling the game gives it all back.
            {:else}Take each player’s {unit(buyInNow)} in cash or Venmo before the first hand. Tap when it is in.{/if}
          </p>
        {/if}
        {#each payRowsShown as r (r.playerId)}
          <div class="payrow">
            <span>{labelOf[r.playerId]}</span>
            {#if r.short > 0}
              <span class="small muted">owes {unit(r.short)}{r.owed > r.short ? ' (rebuy)' : ''}</span>
              <span class="row">{#each methods as how (how)}<button class="big" disabled={planPending} onclick={() => payWith(r.playerId, how)}>{inLabel(how)}</button>{/each}</span>
            {:else}
              <span class="small">✓ {unit(r.got)} · {howLabel(r.how)}</span>
              <button class="link" onclick={() => unpay(r.playerId)} aria-label={`Undo ${labelOf[r.playerId]}'s payment`}>Undo</button>
            {/if}
          </div>
        {/each}
        {#if pay.rows.filter((r) => r.short > 0).length > 1}
          <div class="row">
            {#each methods as how (how)}<button class="big" disabled={planPending} onclick={() => payAll(how)}>Everyone paid: {howLabel(how)}</button>{/each}
          </div>
        {/if}
        {#if pay.toCollect === 0}<button class="link" onclick={() => (showPay = false)}>Hide</button>{/if}
      {/if}
    </section>
  {/if}

  {#if pristine}
    <section class="panel" id="poker-plan">
      <h3>Chips and buy-in</h3>
      <p class="small muted">Type the chips you own, lowest value first. The board works out a fair stack for every player and keeps the rest in the bank for rebuys.</p>
      {#if stackMismatch}
        <p class="warnline">⚠ The starting stack ({chips(stackPts)} points) is worth {pts(stackPts)}, but the buy-in is {unit(buyInNow)}. Accept a chip plan below, or fix the settings.</p>
      {/if}
      <div class="row" role="group" aria-label="What players put up">
        <button class="big seg" class:on={planIn.currency === 0} aria-pressed={planIn.currency === 0} onclick={() => planPatch({ currency: 0 })}>Real money</button>
        <button class="big seg" class:on={planIn.currency === 1} aria-pressed={planIn.currency === 1} onclick={() => planPatch({ currency: 1 })}>Gold</button>
      </div>
      <div class="planfields">
        <label>Buy-in per player ({planIn.currency ? 'gold' : '$'})<input class="mono" type="text" inputmode="decimal" value={planIn.buyIn} onchange={commitBuyIn} /></label>
        <label>Players<input class="mono" type="text" inputmode="numeric" value={planIn.players} onchange={commitPlayers} /></label>
        <label>Chips to players (%)<input class="mono" type="text" inputmode="decimal" value={Math.round(planIn.sharePercent * 10) / 10} onchange={commitShare} /></label>
      </div>
      {#if planCols.length}<div class="colhead small muted"><span>Colour</span><span>How many</span><span>Value each (optional)</span></div>{/if}
      {#each planCols as c, i (i)}
        <div class="colrow">
          <input list="poker-colours" value={c.name} aria-label={`Chip colour ${i + 1}`} onchange={(e) => setColour(i, { name: e.currentTarget.value })} />
          <input class="mono" type="text" inputmode="numeric" value={c.count || ''} placeholder="0" aria-label={`How many ${c.name || 'colour ' + (i + 1)} chips`} onchange={(e) => commitCount(e, i)} />
          <input class="mono" type="text" inputmode="decimal" value={valText(c.value)} placeholder={c.count > 0 ? planUnit(((suggested[planCols.slice(0, i).filter((x) => x.count > 0).length] ?? 0)) / ppu).replace(/ gold$/, '') : ''} aria-label={`Value of one ${c.name || 'colour ' + (i + 1)} chip`} onchange={(e) => commitValue(e, i)} />
          <span class="colbtns">
            <button onclick={() => moveColour(i, -1)} disabled={i === 0} aria-label={`Move ${c.name} up`}>↑</button>
            <button onclick={() => moveColour(i, 1)} disabled={i === planCols.length - 1} aria-label={`Move ${c.name} down`}>↓</button>
            <button onclick={() => dropColour(i)} aria-label={`Remove ${c.name}`}>✕</button>
          </span>
        </div>
      {/each}
      <datalist id="poker-colours">{#each COLOUR_NAMES as n (n)}<option value={n}></option>{/each}</datalist>
      <button class="big" onclick={addColour} disabled={planCols.length >= MAX_COLOURS}>{planCols.length ? 'Add a colour' : 'Add your first colour'}</button>
      {#if planMsg}<p class="error">{planMsg}</p>{/if}

      <div class="planout">
        {#if !chipsTyped}
          <p class="small muted">No chips entered: every player gets {chips(outcome?.stack ?? 0)} points ({planWorth(outcome?.stack ?? 0)}), the same as the buy-in. Add your chips above for a planned stack and a bank.</p>
        {:else if plan.status === 'empty'}
          <p class="small muted">{plan.problems.join(' ')}</p>
        {:else if plan.problems.length}
          {#each plan.problems as pr (pr)}<p class="warnline">⚠ {pr}</p>{/each}
        {:else}
          <p><strong>{plan.status === 'exact' ? `✓ Every player gets exactly ${planWorth(plan.stack)}.` : plan.status === 'adjusted' ? `⚠ Closest fair stack: ${planWorth(plan.stack)} (the buy-in is ${planWorth(plan.target)}).` : '⚠ These chips can’t make a fair stack.'}</strong></p>
          <ul class="small">
            {#each plan.rows.filter((r) => r.perPlayer > 0) as r (r.name + r.value)}
              <li>{r.perPlayer} × {r.name} ({planWorth(r.value)} each){r.typed ? '' : ' · suggested value'} · bank keeps {r.bankLeft}</li>
            {/each}
          </ul>
          <p class="small">Stack {chips(plan.stack)} points = {planWorth(plan.stack)}. Bank keeps {planWorth(plan.bankValue)}, enough for {plan.rebuys} more {plan.rebuys === 1 ? 'rebuy' : 'rebuys'}.</p>
          {#if plan.blinds}
            <p class="small muted">Suggested first blinds: {chips(plan.blinds.sb)}/{chips(plan.blinds.bb)} points ({planWorth(plan.blinds.sb)}/{planWorth(plan.blinds.bb)}), about {plan.blinds.bigBlinds} big blinds. Blinds come from the settings (now {chips(blindsFor(1, ctx.settings).sb)}/{chips(blindsFor(1, ctx.settings).bb)}).</p>
          {/if}
        {/if}
        {#each plan.notes as n (n)}<p class="warnline">⚠ {n}</p>{/each}
        {#if outcome || chipsTyped}
          {#if planMatches}
            <p class="small">✓ This plan is in use for the game.</p>
          {:else if planAsk && !planWhy}
            <div class="ask">
              <p><strong>Give every player {chips(outcome?.stack ?? 0)} points ({planWorth(outcome?.stack ?? 0)})?</strong> Rebuys will hand out the same stack, the buy-in becomes {planUnit(planBuyIn)}{planBuyIn !== planIn.buyIn ? ` (the chips can’t make ${planUnit(planIn.buyIn)})` : ''}, and everyone’s chips are reset.</p>
              <div class="row">
                <button class="big primary" onclick={acceptPlan}>Yes, use this plan</button>
                <button class="big" onclick={() => (planAsk = false)}>Cancel</button>
              </div>
            </div>
          {:else}
            <button class="big primary" disabled={!!planWhy} onclick={() => (planAsk = true)}>{chipsTyped ? 'Use this plan' : 'Use these money settings'}</button>
            {#if planWhy}<p class="small muted">{planWhy}</p>{/if}
          {/if}
        {/if}
      </div>
    </section>
  {:else if game.applied || stackMismatch}
    <section class="panel" id="poker-plan">
      <h3>Chips in play</h3>
      {#if game.applied}
        <p class="small">Each player started with {chips(game.applied.startStack)} points ({pts(game.applied.startStack)}). Rebuys give the same.</p>
      {/if}
      {#if bank}
        <p class="small">
          Bank: {bank.rows.filter((r) => r.perPlayer > 0).map((r) => `${r.bank} ${r.name}`).join(', ')}. Covers {Math.max(0, bank.rebuysLeft)} more {bank.rebuysLeft === 1 ? 'rebuy' : 'rebuys'}.
        </p>
        {#if bank.rebuysLeft <= 0 || bank.short}<p class="warnline">⚠ The bank can’t cover another rebuy. Add chips from the box or stop rebuys.</p>{/if}
      {/if}
      {#if stackMismatch}
        <p class="warnline">⚠ The starting stack is worth {pts(stackPts)} but the buy-in is {unit(buyInNow)}.</p>
      {/if}
    </section>
  {/if}

  {#if ctx.table}
    <section class="panel">
      <div class="tv-table" bind:clientWidth={W} style="height:{H}px">
        {#if W > 0}
          <div class="tbl" style="width:{fit.tw}px;height:{fit.th}px">
            <strong>{ctx.table.name}</strong>
          </div>
          {#each seatPts as sp (sp.seat)}
            {@const pp = seating.bySeat.get(sp.seat)}
            {@const kind = kindOf(sp.x, sp.y)}
            {#if pp}
              {@const d = pl(game, pp.id, ctx)}
              <button
                class="seat"
                class:sel={pp.id === sel}
                class:out={d.out}
                style="left:{W / 2 + sp.x}px;top:{H / 2 + sp.y}px;width:{S}px;height:{S}px"
                onclick={() => pick(pp.id)}
                aria-label={`${pp.name}, ${d.out ? 'out' : `${chips(d.stack)} chips`}`}
              >
                <span class="av"><Avatar name={pp.name} color={pp.color} src={pp.avatarPath} size={S} /></span>
                <span class={`seattags ${kind.split(' ')[0]}`}>{@render tags(pp.id)}</span>
                <span class={`lbl ${kind}`} style="font-size:{FS}px;max-width:{isSide(kind) ? sideW : topW}px">
                  <b title={pp.name}>{labelOf[pp.id]}</b>
                  <i>{#if crownId === pp.id && !d.out}👑 {/if}{d.out ? 'out' : chips(d.stack)}</i>
                </span>
              </button>
            {:else}
              <div class="seat empty" style="left:{W / 2 + sp.x}px;top:{H / 2 + sp.y}px;width:{S}px;height:{S}px"></div>
            {/if}
          {/each}
        {/if}
      </div>
      <p class="small muted">Beside each name: chips. D = dealer, SB / BB = blinds, 👑 = crown.</p>
    </section>
  {/if}

  {#if seating.rest.length}
    <section class="panel">
      {#if ctx.table}<p class="small muted">Not at the table</p>{/if}
      <div class="row">
        {#each seating.rest as p (p.id)}
          {@const d = pl(game, p.id, ctx)}
          <button class="chip" class:on={p.id === sel} class:out={d.out} onclick={() => pick(p.id)}>
            <Avatar name={p.name} color={p.color} src={p.avatarPath} size={24} />
            {labelOf[p.id]}
            <span class="muted small">{d.out ? 'out' : chips(d.stack)}</span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if !wide && selPlayer}{@render playerPanel(selPlayer)}{/if}

  <section class="panel" bind:this={countEl}>
    <div class="spread">
      <h3>Chip counts</h3>
      {#if !counting}<button class="big primary" onclick={openCount}>Count round</button>{/if}
    </div>
    <p class="small">
      On the table <strong class="mono">{chips(totals.onTable)}</strong> · bought in <strong class="mono">{chips(totals.boughtIn)}</strong>
      ({unit(totals.dollars)})
      · last count {game.snaps.length ? clockTime(game.snaps[game.snaps.length - 1]!.t) : 'none yet'}
    </p>
    {#if totals.diff !== 0}
      <p class="warnline">
        ⚠ {chips(Math.abs(totals.diff))} chips {totals.diff > 0 ? 'more' : 'fewer'} on the table than were bought in.
        {#if totals.diff < 0 && freshBust}A bust-out freed chips: update the winners’ stacks or take a count.
        {:else}Take a count, or check the stacks and rebuys.{/if}
      </p>
    {/if}
    {#if totals.removedChips > 0}
      <p class="warnline">⚠ {chips(totals.removedChips)} chips belong to a player who is no longer in this game.</p>
    {/if}

    {#if counting}
      <div class="field">
        <p class="small muted">
          Everyone count your chips now. Type each number that changed, then save. Boxes you leave alone use the current chips.
          Stamped {clockTime(countOpenedAt)} (when this count started).
        </p>
        {#each active as o, i (o.id)}
          {@const bad = o.id in draft && parseChips(draft[o.id]!) === null}
          <label class="countrow">
            <span>{o.name}</span>
            <input
              class="mono"
              class:bad
              type="text"
              inputmode="numeric"
              enterkeyhint={i === active.length - 1 ? 'done' : 'next'}
              aria-invalid={bad}
              value={draftText(o.id)}
              oninput={(e) => (draft[o.id] = e.currentTarget.value)}
              onkeydown={countKey}
            />
          </label>
        {/each}
        <p class="small">
          Total <strong class="mono">{chips(draftSum)}</strong> of {chips(totals.boughtIn)} bought in
          {#if draftSum !== totals.boughtIn}<span class="warnline">· off by {chips(Math.abs(draftSum - totals.boughtIn))}</span>{/if}
        </p>
        {#if badDraft.length}<p class="error">Can’t read the number for {badDraft.map((o) => o.name).join(', ')}. Use whole chips, like 5,000 or 5k.</p>{/if}
        {#if countError}<p class="error">{countError}</p>{/if}
        <div class="row">
          <button class="big primary" onclick={saveCount}>Save count</button>
          <button class="big" onclick={cancelCount}>{discardAsk ? `Discard ${typedCount} typed number${typedCount === 1 ? '' : 's'}?` : 'Cancel'}</button>
        </div>
      </div>
    {/if}

    {#if chart}
      <div class="field">
        <span class="small muted">Chips through the game ({game.snaps.length} count{game.snaps.length === 1 ? '' : 's'})</span>
        <svg viewBox={`0 0 ${chart.cw} ${chart.ch}`} class="flow" role="img" aria-label="Chip counts over time, one line per player">
          <line x1={chart.padL} y1={chart.ch - chart.padB} x2={chart.cw - chart.padR} y2={chart.ch - chart.padB} stroke="var(--line)" />
          <line x1={chart.padL} y1={chart.padT} x2={chart.padL} y2={chart.ch - chart.padB} stroke="var(--line)" />
          {#each chart.lines as ln (ln.id)}
            <polyline points={ln.points} fill="none" stroke={ln.color} stroke-width="2" stroke-linejoin="round" stroke-dasharray={ln.dash || undefined} />
          {/each}
          <text x={chart.padL + 4} y={chart.padT - 3} font-size="10" fill="var(--muted)">{chips(chart.maxV)} chips</text>
          <text x={chart.padL + 4} y={chart.ch - chart.padB - 3} font-size="10" fill="var(--muted)">0</text>
          <text x={chart.padL} y={chart.ch - 6} font-size="10" fill="var(--muted)">start</text>
          <text x={chart.cw - chart.padR} y={chart.ch - 6} font-size="10" fill="var(--muted)" text-anchor="end">{spanText(chart.spanMs)} in</text>
        </svg>
        <div class="row legend">
          {#each chart.lines as ln (ln.id)}
            <span class="small">
              <svg width="18" height="8" class="key" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke={ln.color} stroke-width="2" stroke-dasharray={ln.dash || undefined} /></svg>{ln.name}
            </span>
          {/each}
        </div>
        <button class="link" onclick={() => (showNumbers = !showNumbers)}>{showNumbers ? 'Hide the numbers' : 'Show the numbers'}</button>
        {#if showNumbers}
          <div class="scroll-x">
            <table class="standings">
              <thead>
                <tr><th>Time</th>{#each ctx.players as p (p.id)}<th class="num">{labelOf[p.id]}</th>{/each}<th></th></tr>
              </thead>
              <tbody>
                {#each [...game.snaps].reverse() as sn (sn.id)}
                  <tr>
                    <td class="mono">{clockTime(sn.t)}</td>
                    {#each ctx.players as p (p.id)}<td class="num mono">{chips(sn.stacks[p.id] ?? 0)}</td>{/each}
                    <td><button class="link" onclick={() => removeSnap(sn.id)}>{removeAsk === sn.id ? 'Sure?' : 'Remove'}</button></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/if}
  </section>

  <section class="panel">
    <h3>Mark out together</h3>
    <p class="small muted">Tap everyone who went out on this hand. Two or more share a place. One tap on one player works too.</p>
    <div class="row">
      {#each active as o (o.id)}
        <button class="chip" class:on={bustPick.includes(o.id)} aria-pressed={bustPick.includes(o.id)} onclick={() => toggleBust(o.id)}>
          <Avatar name={o.name} color={o.color} src={o.avatarPath} size={24} />
          {labelOf[o.id]}
        </button>
      {/each}
    </div>
    {#if bustNotice}<p class="error">{bustNotice}</p>{/if}
    {#if winnerAsk && winnerAsk.from === 'together'}{@render winnerPicker(winnerAsk.pids)}{/if}
    <button class="big danger" disabled={!bustPick.length || (winnerAsk !== null && winnerAsk.from === 'together')} onclick={doBustSelected}>{bustPick.length ? `Mark ${bustPick.length} out` : 'Mark out'}</button>
  </section>

  <section class="panel">
    <h3>Standings if the game ended now</h3>
    <div class="scroll-x">
      <table class="standings">
        <thead>
          <tr><th>Place</th><th>Player</th><th class="num">Chips</th>{#if payNeeded}<th class="num">Cashes out</th>{/if}</tr>
        </thead>
        <tbody>
          {#each standings as r (r.playerId)}
            <tr class:out={r.out}>
              <td class="mono">{ordinal(r.place)}{r.tied ? '=' : ''}</td>
              <td><button class="link" onclick={() => pick(r.playerId)}>{labelOf[r.playerId]}</button></td>
              <td class="num mono">{r.out ? 'out' : chips(r.stack)}</td>
              {#if payNeeded}<td class="num mono">{unit(r.cashOut)}</td>{/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if payNeeded}
      <p class="small muted">Everyone is paid what their chips are worth. Money in: {unit(cashOut.invested)} · paid out: {unit(cashOut.cashOut)}.</p>
      {#if cashOut.diff !== 0}<p class="warnline">⚠ The cash-outs are {unit(Math.abs(cashOut.diff))} {cashOut.diff > 0 ? 'more' : 'less'} than the money put in. Count the chips again before paying anyone.</p>{/if}
    {/if}
  </section>

  {#if showRecap || stat.over}
    <section class="panel">
      <h3>Game recap</h3>
      <div class="grid2">
        {#each standings as r (r.playerId)}
          <div class="card">
            <div class="spread"><strong>{r.name}</strong><span class="badge">{ordinal(r.place)}{r.tied ? ' (tied)' : ''}</span></div>
            <p class="small">
              {#if cash}Finished with {chips(r.stack)} chips.
              {:else if r.out}Went out{r.outAfterMs !== null ? ` after ${spanText(r.outAfterMs)}` : ''}.
              {:else if r.winner}Last one standing with {chips(r.stack)} chips.
              {:else}Still in with {chips(r.stack)} chips.{/if}
            </p>
            <p class="small muted">
              Bought in {unit(r.dollars)}{r.rebuys ? ` (${r.rebuys} rebuy${r.rebuys === 1 ? '' : 's'})` : ''}
              {#if payNeeded}<br />Cashes out {unit(r.cashOut)}{/if}
              {#if r.trail.length >= 3}<br />Chips: {r.trail.slice(-8).map(chips).join(' → ')}{/if}
              {#if r.peak > r.stack && r.peak > (r.trail[0] ?? 0) && r.trail.length >= 3}<br />Biggest stack: {chips(r.peak)}{r.peakAfterMs !== null ? ` (${spanText(r.peakAfterMs)} in)` : ''}{/if}
            </p>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <section class="panel">
    <h3>Game history</h3>
    <div class="note">
      <select bind:value={noteAbout} aria-label="Note is about">
        <option value="">Whole game</option>
        {#each ctx.players as p (p.id)}<option value={String(p.id)}>{p.name}</option>{/each}
      </select>
      <input
        type="text"
        maxlength={NOTE_MAX}
        placeholder="Add a note to the history"
        bind:value={noteText}
        onkeydown={(e) => {
          if (e.key === 'Enter') submitNote();
        }}
      />
      <button class="primary big" disabled={!noteText.trim()} onclick={submitNote}>Add</button>
    </div>
    {#if !entries.length}
      <p class="muted small">Nothing yet. Every change and note will show here with its time.</p>
    {:else}
      <ul class="log">
        {#each shownEntries as e (e.id)}
          <li class:note-entry={e.kind === 'note'}>
            <span class="mono muted small">{time(e.t)}</span>
            <span>
              {describeEntry(e, nameOf, ctx.settings)}
              {#if e.kind === 'note'}<button class="link small" onclick={() => apply(removeNote(cur(), e.id))} aria-label="Delete this note">Delete</button>{/if}
            </span>
          </li>
        {/each}
      </ul>
      {#if entries.length > 30}
        <button onclick={() => (showAll = !showAll)}>{showAll ? 'Show fewer' : `Show all ${entries.length}`}</button>
      {/if}
    {/if}
  </section>
</div>
{#if wide}
  <div class="right" aria-label="All players">
    {#each ctx.players as p (p.id)}{@render playerPanel(p)}{/each}
  </div>
{/if}
</div>
</div>

<style>
  .poker {
    max-width: 40rem;
    margin: 0 auto;
  }
  .poker.wide {
    max-width: none;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 27rem);
    gap: 0.75rem;
    align-items: start;
  }
  .right {
    display: grid;
    gap: 0.5rem;
  }
  .right :global(.panel) {
    margin: 0;
    min-width: 0;
  }
  .pp.cur {
    outline: 2px solid var(--accent);
  }
  .win {
    margin: 0.6rem 0;
    padding: 0.6rem;
    border: 1px solid var(--good);
    border-radius: var(--radius);
    color: var(--good);
  }
  .alert {
    border: 2px solid var(--accent);
  }
  .ask {
    margin-top: 0.5rem;
    padding: 0.6rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
  }
  .calltime {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.6rem;
  }
  /* warnings never rely on colour alone: a mark, bold text and a bar */
  .warnline {
    margin: 0.3rem 0;
    padding-left: 0.5rem;
    border-left: 3px solid var(--danger, var(--text));
    color: var(--danger, var(--text));
    font-weight: 600;
  }

  /* money: buy-ins and the chip plan */
  .payrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.7rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--line);
  }
  .payrow > span:first-child {
    min-width: 5rem;
    font-weight: 600;
  }
  .seg.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .planfields {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.4rem;
    margin: 0.6rem 0;
    align-items: end;
  }
  .planfields label {
    display: grid;
    gap: 0.2rem;
    font-size: 0.85rem;
  }
  .planfields input,
  .colrow input {
    width: 100%;
    min-width: 0;
    min-height: 44px;
  }
  .colhead,
  .colrow {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.3rem;
    align-items: center;
  }
  .colrow {
    margin-bottom: 0.5rem;
  }
  .colbtns {
    grid-column: 1 / -1;
    display: flex;
    gap: 0.3rem;
  }
  .colbtns button {
    min-width: 44px;
    padding: 0 0.5rem;
  }
  .planout ul {
    margin: 0.3rem 0;
    padding-left: 1.1rem;
  }

  /* blind clock */
  .blinds {
    font-size: 1.7rem;
    font-weight: 700;
  }
  .clockbox {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.2rem;
  }
  .countdown {
    font-size: 2.2rem;
    font-weight: 700;
  }
  .countdown.low {
    color: var(--danger, var(--accent));
  }
  .countdown.paused {
    opacity: 0.55;
  }

  /* dealer / blind markers sit just inside the picture's corner, so they never reach a neighbour's name */
  .tag {
    display: inline-block;
    min-width: 1.4rem;
    padding: 0 0.3rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 1.3rem;
    text-align: center;
  }
  .tag.d {
    background: var(--accent);
    color: var(--bg);
  }
  .seattags {
    position: absolute;
    display: flex;
    gap: 2px;
    line-height: 1;
  }
  .seattags.top {
    bottom: -2px;
    right: -2px;
  }
  .seattags.bot {
    top: -2px;
    right: -2px;
  }
  .seattags.r {
    bottom: -2px;
    right: -2px;
  }
  .seattags.l {
    bottom: -2px;
    left: -2px;
  }

  /* table */
  .tv-table {
    position: relative;
    width: 100%;
    max-width: 34rem;
    margin: 0 auto;
    overflow: hidden;
  }
  .tbl {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    overflow: hidden;
    padding: 0 6px;
  }
  .tbl strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9rem;
  }
  .seat {
    position: absolute;
    transform: translate(-50%, -50%);
    padding: 0;
    min-height: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    line-height: 0;
  }
  .seat.sel {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .seat.empty {
    border: 2px dashed var(--muted);
    opacity: 0.6;
  }
  /* only the picture fades when a player is out; the name and "out" stay readable */
  .seat.out .av {
    opacity: 0.45;
    filter: grayscale(1);
  }
  .seat.out .lbl b {
    color: var(--muted);
  }
  .lbl {
    position: absolute;
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    white-space: nowrap;
    color: var(--text);
    pointer-events: none;
  }
  .lbl.top,
  .lbl.bot {
    left: 50%;
    transform: translateX(-50%);
    align-items: center;
  }
  .lbl.top {
    bottom: 100%;
    margin-bottom: 2px;
  }
  .lbl.bot {
    top: 100%;
    margin-top: 2px;
  }
  /* side seats: the name goes on the table side of the picture, over the empty table, and is nudged away from the
     nearest corner seat (upper seats' names slightly down, lower seats' names slightly up) */
  .lbl.r,
  .lbl.l {
    top: 50%;
    transform: translateY(-50%);
  }
  .lbl.up {
    transform: translateY(calc(-50% + 8px));
  }
  .lbl.dn {
    transform: translateY(calc(-50% - 8px));
  }
  .lbl.r {
    right: 100%;
    margin-right: 3px;
    align-items: flex-end;
    text-align: right;
  }
  .lbl.l {
    left: 100%;
    margin-left: 3px;
    align-items: flex-start;
    text-align: left;
  }
  .lbl b,
  .lbl i {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-style: normal;
  }
  .lbl i {
    color: var(--muted);
    font-size: 0.92em;
  }

  /* chips, steppers */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .chip.out {
    opacity: 0.6;
  }
  .chip.on {
    outline: 2px solid var(--accent);
  }
  .stepfield .num {
    display: block;
    width: 100%;
    min-height: 48px;
    margin: 0.2rem 0 0.3rem;
    text-align: center;
    font-size: 1.3rem;
  }
  .steps {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.3rem;
  }
  .steps button {
    min-width: 0;
    min-height: 48px;
    padding: 0 0.2rem;
    font-size: 0.95rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sel {
    min-height: 44px;
    max-width: 100%;
  }

  /* count round */
  .countrow {
    display: grid;
    grid-template-columns: 1fr 8rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.2rem 0;
  }
  .countrow input {
    min-height: 44px;
    text-align: right;
  }
  .countrow input.bad {
    border-color: var(--danger, var(--text));
    border-width: 2px;
  }

  /* flow chart */
  .flow {
    display: block;
    width: 100%;
    height: auto;
  }
  .legend {
    gap: 0.6rem;
  }
  .key {
    display: inline-block;
    margin-right: 0.25rem;
    vertical-align: middle;
  }
  .standings th,
  .standings td {
    padding: 0.4rem 0.3rem;
    font-size: 0.92rem;
  }

  /* standings, recap */
  tr.out td {
    opacity: 0.7;
  }
  button.link {
    border: 0;
    background: none;
    padding: 0.3rem 0.4rem;
    min-height: 44px;
    min-width: 44px;
    text-decoration: underline;
    text-align: left;
  }
  .card {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.6rem;
  }
  .card p {
    margin: 0.3rem 0 0;
  }

  /* history */
  .note {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }
  .note select {
    grid-column: 1 / -1;
    min-height: 44px;
  }
  .note input {
    min-height: 48px;
  }
  .log {
    list-style: none;
    margin: 0 0 0.6rem;
    padding: 0;
  }
  .log li {
    display: grid;
    grid-template-columns: 7.2rem 1fr;
    gap: 0.4rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--line);
    overflow-wrap: anywhere;
  }
  .log li span:first-child {
    white-space: nowrap;
  }
  .log li.note-entry span:last-child {
    font-weight: 600;
  }
  .log li button.link {
    font-weight: 400;
    min-height: 44px;
  }
</style>
