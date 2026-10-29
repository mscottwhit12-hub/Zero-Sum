<script lang="ts">
  /**
   * Hosts one game's board (gm/boards/<key>): builds its context, loads and saves its state on the server
   * (versioned; a stale save reloads), sends its score to the crown, stores its recap, and opens the result
   * screen pre-filled from its placements.
   */
  import { onDestroy, onMount } from 'svelte';
  import { ApiError, api, get, post } from '@shared/api';
  import { errorText, run, toast } from '@shared/ui';
  import type { GameInfo, GmState } from '@shared/types';
  import { BOARDS, boardSettingsFor } from '../boards';
  import { gameClock, gameTag } from '@shared/gameTime';
  import type { BoardContext, BoardPlayer } from '../boards/contract';

  let { gs, game, onfinish }: { gs: GmState | null; game: GameInfo; onfinish: (placements: number[][] | null) => void } = $props();

  const entry = $derived(game.board ? (BOARDS[game.board] ?? null) : null);
  const table = $derived(game.tableId == null ? null : (gs?.gm?.seating.find((t) => t.id === game.tableId) ?? null));
  const rerollsLeft = $derived(gs?.gm?.rerolls ?? {});
  const settings = $derived(game.board ? boardSettingsFor(game.board, gs?.gm?.boardSettings) : {});
  const players = $derived.by((): BoardPlayer[] =>
    game.participants.map((p) => {
      const info = gs?.players.find((x) => x.id === p.playerId);
      return {
        id: p.playerId,
        name: info?.displayName ?? '?',
        color: info?.color ?? null,
        avatarPath: info?.avatarPath ?? null,
        seat: table?.assignments.find((a) => a.playerId === p.playerId)?.seat ?? null,
      };
    }),
  );
  const newRequestId = () => `rr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const ctx = $derived<BoardContext>({
    players,
    table: table ? { name: table.name, seats: table.seats, w: table.w, h: table.h } : null,
    rerollsAllowed: game.rerollsAllowed,
    rerollsLeft,
    useReroll: (playerId: number) => post('/api/rerolls', { gameId: game.id, playerId, requestId: newRequestId() }),
    settings,
    startedAt: game.startedAt,
    endsAt: game.startedAt != null && game.plannedDurationHours ? game.startedAt + game.plannedDurationHours * 3_600_000 : null,
  });

  let board = $state<unknown>(null);
  let version = 0;
  let loaded = $state(false);
  let failed = $state<string | null>(null);
  let saving = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastScores = '';

  async function load() {
    try {
      const r = await get<{ state: unknown; version: number }>(`/api/games/${game.id}/board`);
      version = r.version;
      if (r.state == null && entry) {
        board = entry.def.init(ctx);
        dirty = true;
        void flush();
      } else board = r.state;
      loaded = true;
      failed = null;
    } catch (e) {
      failed = errorText(e);
    }
  }

  async function flush() {
    if (!entry || saving || !dirty) return;
    saving = true;
    dirty = false;
    const state = $state.snapshot(board);
    try {
      const recap = entry.def.recap?.(state, ctx);
      const r = await api<{ version: number }>('PUT', `/api/games/${game.id}/board`, { state, version, recap });
      version = r.version;
      if (game.leadMode !== 'manual') {
        const scores = entry.def.score(state, ctx);
        const key = JSON.stringify(scores);
        if (key !== lastScores) {
          lastScores = key;
          await post(`/api/games/${game.id}/scores`, { scores: Object.entries(scores).map(([playerId, score]) => ({ playerId: Number(playerId), score })) }).catch(
            (e) => toast(errorText(e), 'error'),
          );
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'board_stale') {
        toast(errorText(e));
        dirty = false;
        await load();
      } else {
        toast(errorText(e), 'error');
        dirty = true; // keep the change; retry on the next edit
      }
    } finally {
      saving = false;
      if (dirty) schedule();
    }
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), 350);
  }
  function onchange(next: unknown) {
    if (next === board) return;
    board = next;
    dirty = true;
    schedule();
  }
  function finish() {
    if (!entry) return onfinish(null);
    if (dirty) void flush();
    onfinish(entry.def.placements?.($state.snapshot(board), ctx) ?? null);
  }

  // Another GM saved: reload unless this device has unsaved edits.
  function onRemote(e: Event) {
    const d = (e as CustomEvent<{ gameId: number; version: number }>).detail;
    if (d.gameId === game.id && d.version > version && !dirty && !saving) void load();
  }
  let now = $state(Date.now());
  const tick = setInterval(() => (now = Date.now()), 15_000);
  onMount(() => {
    void load();
    window.addEventListener('gn:board-update', onRemote);
  });
  onDestroy(() => {
    clearInterval(tick);
    window.removeEventListener('gn:board-update', onRemote);
    if (timer) clearTimeout(timer);
    if (dirty) void flush();
  });
</script>

<section class="panel">
  <div class="spread">
    <div>
      <h2>{game.name} {#if gameTag(game, now) === 'filibuster'}<span class="badge warn">Filibuster</span>{/if}</h2>
      <p class="small muted">{gameClock(game, now)}</p>
    </div>
    <button onclick={finish}>Enter result</button>
  </div>
  {#if !entry}
    <p class="muted">This game's board ({game.board}) isn't installed on this server. Use the Dashboard to enter scores.</p>
  {:else if failed}
    <p class="muted">{failed}</p>
    <button onclick={() => run(load)}>Try again</button>
  {:else if !loaded || board == null}
    <p class="muted">Loading board…</p>
  {:else}
    {@const Board = entry.Board}
    <Board {ctx} state={board} {onchange} onfinish={finish} />
  {/if}
</section>
