<script lang="ts">
  /**
   * Monopoly board: the GM's control panel and live tracker. Players around their table, each showing their assets
   * (property prices + buildings); per player: the properties they own with house/hotel controls (full building rules
   * checked in ./def.ts), optional cash, bankruptcy, re-rolls. A bank panel hands properties out (with an optional
   * auction price for the history), plus standings, a timestamped game history with typed notes, and the recap.
   * All rules live in ./def.ts; this file only draws and calls those operations.
   */
  import Avatar from '../../../shared/Avatar.svelte';
  import type { BoardPlayer, BoardProps } from '../contract';
  import {
    GROUPS,
    NOTE_MAX,
    PROPS,
    addNote,
    assetsOf,
    assign,
    assignBlock,
    buildBlock,
    buildStep,
    cfg,
    declareBankrupt,
    describeEntry,
    hotelLevel,
    holdsSet,
    levelLabel,
    lvl,
    money,
    ordinal,
    ownedBy,
    pl,
    po,
    priceOf,
    propsInGroup,
    recap,
    recordReroll,
    restore,
    setCash,
    startCash,
    status,
    supply,
    type MonoState,
    type PropDef,
  } from './def';
  import { clamp, seatPoints } from './seating';

  let { ctx, state: game, onchange, onfinish }: BoardProps<MonoState> = $props();

  let picked = $state<number | null>(null);
  let confirmFor = $state<number | null>(null);
  let noteText = $state('');
  let noteAbout = $state('');
  let showAll = $state(false);
  let showRecap = $state(false);
  let busy = $state<Record<number, boolean>>({});
  let rerollFailed = $state<Record<number, boolean>>({});
  /** Per-player message when a move isn't allowed (and why). */
  let notice = $state<Record<number, { key: string; msg: string }>>({});
  let addSel = $state<Record<number, string>>({});
  let addPrice = $state<Record<number, string>>({});
  let bankPrice = $state('');
  let bankNotice = $state('');
  /** Board width: wide (laptop) shows every player's panel at once in a scrolling right column. */
  let RW = $state(0);
  const wide = $derived(RW >= 900);
  let W = $state(0);

  /** Only pass on a genuinely new state (the host may also dedupe, but this keeps double taps quiet). */
  const apply = (next: MonoState) => {
    if (next !== game) onchange(next);
  };
  const now = () => Date.now();
  const nameOf = (id: number) => ctx.players.find((p) => p.id === id)?.name ?? 'Another player';
  const first = (n: string) => n.split(/\s+/)[0] ?? n;
  /** `key` = the property the message is about ('' = the "add a property" area); shown right under it. */
  const say = (pid: number, msg: string, key = '') => (notice = { ...notice, [pid]: { key, msg } });
  const noteFor = (pid: number, key: string) => (notice[pid]?.key === key ? (notice[pid]?.msg ?? '') : '');

  // ---- derived
  const hotel = $derived(hotelLevel(ctx.settings));
  const sel = $derived(picked !== null && ctx.players.some((p) => p.id === picked) ? picked : (ctx.players[0]?.id ?? null));
  const selPlayer = $derived(ctx.players.find((p) => p.id === sel) ?? null);
  const stat = $derived(status(game, ctx));
  const standings = $derived(recap(game, ctx));
  const sup = $derived(supply(game, ctx.settings));
  const housesTotal = $derived(Math.floor(cfg(ctx.settings, 'housesSupply')));
  const hotelsTotal = $derived(Math.floor(cfg(ctx.settings, 'hotelsSupply')));
  const unowned = $derived(PROPS.filter((x) => po(game, x.key).owner === null));
  const leftOf = (id: number) => ctx.rerollsLeft[id] ?? 0;
  const entries = $derived([...game.log].reverse());
  const shownEntries = $derived(showAll ? entries : entries.slice(0, 30));
  const assets = (id: number) => assetsOf(game, id, ctx.settings);
  /** Players a property can be moved to (not the holder, not bankrupt). */
  const movable = (pid: number) => ctx.players.filter((o) => o.id !== pid && !pl(game, o.id).bankrupt);
  const active = $derived(ctx.players.filter((o) => !pl(game, o.id).bankrupt));

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
  const S = $derived(Math.round(clamp(W * 0.12, 40, 56)));
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

  // ---- actions
  const pick = (id: number) => {
    picked = id;
    confirmFor = null;
    rerollFailed = {};
    if (wide) document.getElementById(`mono-p-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const commitNumber = (e: Event, current: number, set: (v: number) => void) => {
    const input = e.currentTarget as HTMLInputElement;
    const n = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(n)) input.value = String(current);
    else set(n);
  };

  /** '' = none given (fine); a number >= 0 = the price; undefined = typed something that isn't a price. */
  const parsePrice = (txt: string): number | null | undefined => {
    const t = txt.trim().replace(/^\$/, '').replace(/,/g, '');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const BAD_PRICE = 'Enter the auction price as a number, or leave it empty.';

  async function useReroll(pid: number) {
    if (busy[pid] || leftOf(pid) <= 0) return;
    busy[pid] = true;
    rerollFailed = { ...rerollFailed, [pid]: false };
    try {
      await ctx.useReroll(pid);
      apply(recordReroll(game, ctx, pid, now()));
    } catch {
      rerollFailed = { ...rerollFailed, [pid]: true };
    } finally {
      busy[pid] = false;
    }
  }

  function doBuild(pid: number, key: string, dir: 1 | -1) {
    const why = buildBlock(game, ctx, key, dir);
    if (why) return say(pid, why, key);
    say(pid, '');
    apply(buildStep(game, ctx, key, dir, now()));
  }

  /** Moves an owned property to another player or the bank. */
  function doMove(pid: number, key: string, toStr: string) {
    if (toStr === '') return;
    const to = toStr === 'bank' ? null : Number(toStr);
    const why = assignBlock(game, ctx, key, to);
    if (why) return say(pid, why, key);
    say(pid, '');
    apply(assign(game, ctx, key, to, now()));
  }

  /** Gives the player a property from the "add" list (from the bank or from another player). */
  function doAdd(pid: number) {
    const key = addSel[pid];
    if (!key) return;
    const price = parsePrice(addPrice[pid] ?? '');
    if (price === undefined) return say(pid, BAD_PRICE);
    const why = assignBlock(game, ctx, key, pid);
    if (why) return say(pid, why);
    say(pid, '');
    apply(assign(game, ctx, key, pid, now(), price));
    addSel = { ...addSel, [pid]: '' };
    addPrice = { ...addPrice, [pid]: '' };
  }

  /** From the bank panel: this property goes to that player (price optional, history only). */
  function giveFromBank(key: string, toStr: string) {
    if (toStr === '') return;
    const price = parsePrice(bankPrice);
    if (price === undefined) {
      bankNotice = BAD_PRICE;
      return;
    }
    const to = Number(toStr);
    const why = assignBlock(game, ctx, key, to);
    if (why) {
      bankNotice = why;
      return;
    }
    bankNotice = '';
    apply(assign(game, ctx, key, to, now(), price));
    bankPrice = '';
  }

  const doBankrupt = (pid: number) => {
    apply(declareBankrupt(game, ctx, pid, now()));
    confirmFor = null;
  };

  const submitNote = () => {
    if (!noteText.trim()) return;
    apply(addNote(game, ctx, noteText, noteAbout === '' ? null : Number(noteAbout), now()));
    noteText = '';
  };

  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const sub = (x: PropDef) => `${money(priceOf(x, ctx.settings))}`;
</script>

{#snippet stepper(label: string, value: number, steps: number[], set: (v: number) => void)}
  <div class="field">
    <span class="small muted">{label}</span>
    <div class="stepper">
      {#each [...steps].reverse() as s (s)}
        <button onclick={() => set(value - s)} aria-label={`${label} minus ${s}`}>−{s}</button>
      {/each}
      <input class="mono" type="number" inputmode="numeric" {value} aria-label={label} onchange={(e) => commitNumber(e, value, set)} />
      {#each steps as s (s)}
        <button onclick={() => set(value + s)} aria-label={`${label} plus ${s}`}>+{s}</button>
      {/each}
    </div>
  </div>
{/snippet}

<!-- The properties a player holds, by colour set. Bankrupt players only get the "move to" control. -->
{#snippet holdings(p: BoardPlayer, out: boolean)}
  {#each GROUPS as g (g.key)}
    {@const mine = ownedBy(game, p.id).filter((x) => x.group === g.key)}
    {#if mine.length}
      {@const complete = holdsSet(game, g.key, p.id)}
      <div class="grp">
        <div class="spread">
          <strong>{g.label}</strong>
          <span class="small muted">{mine.length} of {propsInGroup(g.key).length}{complete ? ' · complete set' : ''}</span>
        </div>
        {#each mine as prop (prop.key)}
          {@const lv = lvl(game, prop.key, ctx.settings)}
          <div class="prow">
            <div class="pname">
              <span>{prop.name}</span>
              <span class="small muted mono">{sub(prop)}{g.street && !out ? ` · ${levelLabel(lv, hotel)}` : ''}</span>
            </div>
            <div class="pctl">
              {#if g.street && !out}
                {#if complete}
                  <button class="big sq" onclick={() => doBuild(p.id, prop.key, -1)} aria-label={`Sell a building on ${prop.name}`}>−</button>
                  <button class="big sq" onclick={() => doBuild(p.id, prop.key, 1)} aria-label={`Build on ${prop.name}`}>+</button>
                {:else}
                  <span class="small muted">needs the full set to build</span>
                {/if}
              {/if}
              <select class="sel" aria-label={`Move ${prop.name}`} onchange={(e) => { doMove(p.id, prop.key, e.currentTarget.value); e.currentTarget.value = ''; }}>
                <option value="">Move to…</option>
                <option value="bank">The bank</option>
                {#each movable(p.id) as o (o.id)}<option value={String(o.id)}>{o.name}</option>{/each}
              </select>
            </div>
          </div>
          {#if noteFor(p.id, prop.key)}<p class="error">{noteFor(p.id, prop.key)}</p>{/if}
        {/each}
      </div>
    {/if}
  {/each}
{/snippet}

{#snippet playerPanel(p: BoardPlayer)}
  {@const d = pl(game, p.id)}
  {@const mineCount = ownedBy(game, p.id).length}
  <section class="panel pp" class:cur={p.id === sel} id={`mono-p-${p.id}`}>
    <div class="spread">
      <div class="row">
        <Avatar name={p.name} color={p.color} src={p.avatarPath} size={36} />
        <h2>{p.name}</h2>
      </div>
      <span class="badge" class:live={!d.bankrupt}>{d.bankrupt ? 'Bankrupt' : `Assets ${money(assets(p.id))}`}</span>
    </div>

    {#if d.bankrupt}
      <p>
        Out of the game.
        {#if d.bankruptAt !== null}<span class="muted small">{time(d.bankruptAt)}</span>{/if}
      </p>
      <button class="big" onclick={() => apply(restore(game, ctx, p.id, now()))}>Undo bankruptcy</button>
      {#if mineCount}
        <div class="field">
          <p class="small muted">Still holding {mineCount} {mineCount === 1 ? 'property' : 'properties'}; move {mineCount === 1 ? 'it' : 'them'} to a player or the bank. Not counted in assets meanwhile.</p>
          {@render holdings(p, true)}
        </div>
      {/if}
    {:else}
      {#if d.cash === null}
        <div class="field">
          <span class="small muted">Cash (optional)</span>
          <button class="big" onclick={() => apply(startCash(game, ctx, p.id, now()))}>Track cash (start at {money(cfg(ctx.settings, 'startCash'))})</button>
        </div>
      {:else}
        {@render stepper('Cash', d.cash, [10, 100], (v) => apply(setCash(game, ctx, p.id, v, now())))}
        <button class="link" onclick={() => apply(setCash(game, ctx, p.id, null, now()))}>Stop tracking cash</button>
      {/if}

      <div class="field">
        <span class="small muted">Properties ({mineCount})</span>
        {#if !mineCount}<p class="muted small">None yet.</p>{/if}
        {@render holdings(p, false)}
      </div>

      <div class="field">
        <span class="small muted">Add a property</span>
        <div class="addrow">
          <select class="sel" bind:value={addSel[p.id]} aria-label={`Property for ${p.name}`}>
            <option value="">Choose a property…</option>
            {#each GROUPS as g (g.key)}
              {@const pool = propsInGroup(g.key).filter((x) => po(game, x.key).owner !== p.id)}
              {#if pool.length}
                <optgroup label={g.label}>
                  {#each pool as prop (prop.key)}
                    {@const holder = po(game, prop.key).owner}
                    <option value={prop.key}>{prop.name} · {sub(prop)}{holder !== null ? ` (${nameOf(holder)})` : ''}</option>
                  {/each}
                </optgroup>
              {/if}
            {/each}
          </select>
          <input class="mono" type="text" inputmode="numeric" placeholder="Auction price (optional)" bind:value={addPrice[p.id]} aria-label="Auction price, optional" />
          <button class="big primary" disabled={!addSel[p.id]} onclick={() => doAdd(p.id)}>Add</button>
        </div>
        {#if noteFor(p.id, '')}<p class="error">{noteFor(p.id, '')}</p>{/if}
      </div>

      {#if ctx.rerollsAllowed}
        <div class="field">
          <div class="spread">
            <span>Re-rolls left: <strong class="mono">{leftOf(p.id)}</strong></span>
            <button class="big" disabled={busy[p.id] || leftOf(p.id) <= 0} onclick={() => useReroll(p.id)}>Use a re-roll</button>
          </div>
          {#if rerollFailed[p.id]}<p class="error">That re-roll could not be used. Check how many are left and try again.</p>{/if}
        </div>
      {/if}

      {#if confirmFor === p.id}
        <div class="field">
          <p><strong>Mark {p.name} bankrupt?</strong></p>
          <p class="small muted">Their buildings go back to the bank. Their properties stay with them until you move them.</p>
          <div class="row">
            <button class="big danger" onclick={() => doBankrupt(p.id)}>Yes, bankrupt</button>
            <button class="big" onclick={() => (confirmFor = null)}>Cancel</button>
          </div>
        </div>
      {:else}
        <button class="big danger" disabled={stat.alive.length <= 1} onclick={() => (confirmFor = p.id)}>Mark {first(p.name)} bankrupt</button>
      {/if}
    {/if}
  </section>
{/snippet}

<div class="monohost" bind:clientWidth={RW}>
<div class="monop" class:wide>
<div class="left">
  <section class="panel">
    <div class="spread">
      <h2>Monopoly</h2>
      <div class="row">
        <span class="badge">{stat.alive.length} of {ctx.players.length} still in</span>
        <span class="badge" class:warn={sup.housesLeft === 0}>Houses left {sup.housesLeft} / {housesTotal}</span>
        <span class="badge" class:warn={sup.hotelsLeft === 0}>Hotels left {sup.hotelsLeft} / {hotelsTotal}</span>
        {#if !stat.over}
          <button onclick={() => (showRecap = !showRecap)}>{showRecap ? 'Hide recap' : 'Recap'}</button>
        {/if}
      </div>
    </div>
    {#if stat.over && stat.winnerId !== null}
      <p class="win">
        <strong>{nameOf(stat.winnerId)} is the last player standing.</strong>
        {#if onfinish}Finish the game; the places are filled in for you.{/if}
      </p>
      {#if onfinish}<button class="big primary" onclick={() => onfinish?.()}>Open the result screen</button>{/if}
    {:else if onfinish}
      <div class="calltime">
        <button class="big" onclick={() => onfinish?.()}>Call time and finish</button>
        <span class="small muted">Ranks everyone by assets (then cash).</span>
      </div>
    {/if}
  </section>

  {#if ctx.table}
    <section class="panel">
      <div class="tv-table" bind:clientWidth={W} style="height:{H}px">
        {#if W > 0}
          <div class="tbl" style="width:{fit.tw}px;height:{fit.th}px">
            <strong>{ctx.table.name}</strong>
          </div>
          {#each seatPoints(ctx.table.seats, fit.tw, fit.th, S, 6) as sp (sp.seat)}
            {@const pp = seating.bySeat.get(sp.seat)}
            {@const top = sp.y < -fit.th / 2}
            {#if pp}
              {@const d = pl(game, pp.id)}
              <button
                class="seat"
                class:sel={pp.id === sel}
                class:out={d.bankrupt}
                style="left:{W / 2 + sp.x}px;top:{H / 2 + sp.y}px;width:{S}px;height:{S}px"
                onclick={() => pick(pp.id)}
                aria-label={`${pp.name}, ${d.bankrupt ? 'bankrupt' : `assets ${money(assets(pp.id))}`}`}
              >
                <Avatar name={pp.name} color={pp.color} src={pp.avatarPath} size={S} />
                <span class="lbl" class:above={top} style="font-size:{FS}px;max-width:{Math.round(S * 1.8)}px">
                  <b>{first(pp.name)}</b>
                  <i>{d.bankrupt ? 'bankrupt' : money(assets(pp.id))}</i>
                </span>
              </button>
            {:else}
              <div class="seat empty" style="left:{W / 2 + sp.x}px;top:{H / 2 + sp.y}px;width:{S}px;height:{S}px"></div>
            {/if}
          {/each}
        {/if}
      </div>
      <p class="small muted">Beside each name: assets (property prices + buildings).</p>
    </section>
  {/if}

  {#if seating.rest.length}
    <section class="panel">
      {#if ctx.table}<p class="small muted">Not at the table</p>{/if}
      <div class="row">
        {#each seating.rest as p (p.id)}
          {@const d = pl(game, p.id)}
          <button class="chip" class:on={p.id === sel} class:out={d.bankrupt} onclick={() => pick(p.id)}>
            <Avatar name={p.name} color={p.color} src={p.avatarPath} size={24} />
            {first(p.name)}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if !wide && selPlayer}{@render playerPanel(selPlayer)}{/if}

  <section class="panel">
    <h3>Properties in the bank ({unowned.length})</h3>
    {#if !unowned.length}
      <p class="muted small">Every property is owned.</p>
    {:else}
      <div class="field">
        <input class="mono pricein" type="text" inputmode="numeric" placeholder="Auction price (optional)" bind:value={bankPrice} aria-label="Auction price, optional" />
        <p class="small muted">Only recorded in the game history.</p>
        {#if bankNotice}<p class="error">{bankNotice}</p>{/if}
      </div>
      {#each GROUPS as g (g.key)}
        {@const rest = unowned.filter((x) => x.group === g.key)}
        {#if rest.length}
          <div class="grp">
            <strong>{g.label}</strong>
            {#each rest as prop (prop.key)}
              <div class="prow">
                <div class="pname"><span>{prop.name}</span><span class="small muted mono">{sub(prop)}</span></div>
                <div class="pctl">
                  <select class="sel" aria-label={`Give ${prop.name} to`} onchange={(e) => { giveFromBank(prop.key, e.currentTarget.value); e.currentTarget.value = ''; }}>
                    <option value="">Give to…</option>
                    {#each active as o (o.id)}<option value={String(o.id)}>{o.name}</option>{/each}
                  </select>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/each}
    {/if}
  </section>

  <section class="panel">
    <h3>Standings if the game ended now</h3>
    <div class="scroll-x">
      <table class="standings">
        <thead>
          <tr><th>Place</th><th>Player</th><th class="num">Assets</th><th class="num">Cash</th><th class="num">Props</th></tr>
        </thead>
        <tbody>
          {#each standings as r (r.playerId)}
            <tr class:out={r.bankrupt}>
              <td class="mono">{ordinal(r.place)}{r.tied ? '=' : ''}</td>
              <td><button class="link" onclick={() => pick(r.playerId)}>{r.name}</button></td>
              <td class="num mono">{r.bankrupt ? '–' : money(r.assets)}</td>
              <td class="num mono">{r.cash === null ? '–' : money(r.cash)}</td>
              <td class="num mono">{r.properties.length}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  {#if showRecap || stat.over}
    <section class="panel">
      <h3>Game recap</h3>
      <div class="grid2">
        {#each standings as r (r.playerId)}
          <div class="card">
            <div class="spread"><strong>{r.name}</strong><span class="badge">{ordinal(r.place)}{r.tied ? ' (tied)' : ''}</span></div>
            <p class="small">
              {#if r.bankrupt}Went bankrupt.{:else}Assets {money(r.assets)}{r.cash !== null ? `, cash ${money(r.cash)}` : ''}.{/if}
            </p>
            <p class="small muted">
              Properties: {r.properties.length}
              {#if r.sets.length}<br />Complete sets: {r.sets.join(', ')}{/if}
              {#if r.houses || r.hotels}<br />Buildings: {r.houses} house{r.houses === 1 ? '' : 's'}, {r.hotels} hotel{r.hotels === 1 ? '' : 's'}{/if}
              {#if r.auctionsWon}<br />Auctions won: {r.auctionsWon} ({money(r.auctionSpent)}){/if}
              {#if r.rerollsUsed}<br />Re-rolls used: {r.rerollsUsed}{/if}
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
            <span>{describeEntry(e, nameOf, hotel)}</span>
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
  .monop {
    max-width: 40rem;
    margin: 0 auto;
  }
  .monop.wide {
    max-width: none;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 27rem);
    gap: 0.75rem;
    align-items: start;
  }
  .right {
    position: sticky;
    top: 0.5rem;
    max-height: calc(100vh - 5rem);
    overflow-y: auto;
    display: grid;
    gap: 0.5rem;
    padding-right: 2px;
  }
  .right :global(.panel) {
    margin: 0;
    min-width: 0;
  }
  .right :global(.stepper) {
    min-width: 0;
  }
  .right :global(.stepper input) {
    min-width: 0;
    width: 100%;
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
  .calltime {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.6rem;
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
  .seat.out {
    opacity: 0.45;
  }
  .lbl {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 2px;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.2;
    white-space: nowrap;
    color: var(--text);
    pointer-events: none;
  }
  .lbl.above {
    top: auto;
    bottom: 100%;
    margin: 0 0 2px;
  }
  .lbl b,
  .lbl i {
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
    opacity: 0.5;
  }
  .stepper {
    display: flex;
    gap: 0.3rem;
    align-items: stretch;
  }
  .stepper button {
    flex: 0 0 auto;
    min-width: 2.9rem;
    min-height: 48px;
    padding: 0 0.4rem;
    font-size: 1rem;
  }
  .stepper input {
    flex: 1 1 4rem;
    min-width: 3.5rem;
    min-height: 48px;
    text-align: center;
    font-size: 1.2rem;
  }

  /* properties */
  .grp {
    margin-top: 0.5rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--line);
  }
  .prow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem 0.6rem;
    padding: 0.35rem 0;
  }
  .pname {
    display: flex;
    flex-direction: column;
    min-width: 7rem;
    flex: 1 1 7rem;
    overflow-wrap: anywhere;
  }
  .pctl {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .sq {
    min-width: 48px;
    min-height: 48px;
    padding: 0;
    font-size: 1.2rem;
  }
  .sel {
    min-height: 44px;
    max-width: 100%;
  }
  .pctl .sel {
    width: 8.5rem;
  }
  .pricein {
    width: 100%;
    box-sizing: border-box;
    min-height: 44px;
  }
  .standings th,
  .standings td {
    padding: 0.4rem 0.3rem;
    font-size: 0.92rem;
  }
  .addrow {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.4rem;
  }
  .addrow select,
  .addrow input {
    grid-column: 1 / -1;
    min-height: 44px;
  }
  .addrow button {
    grid-column: 1 / -1;
  }

  /* standings, recap */
  tr.out td {
    opacity: 0.55;
  }
  button.link {
    border: 0;
    background: none;
    padding: 0.3rem 0;
    min-height: 40px;
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
</style>
