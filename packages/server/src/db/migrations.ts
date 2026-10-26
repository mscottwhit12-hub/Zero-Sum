/**
 * Schema migrations. Applied in order; PRAGMA user_version tracks the last applied.
 * Conventions: gold columns are integer hundredths (_h); shares are integer hundredths (_h);
 * wall-clock times are epoch ms; night-clock times (pause excluded) are *_nms.
 */
export const MIGRATIONS: string[] = [
  /* 1 — initial schema (spec §23 + server bookkeeping) */ `
  CREATE TABLE game_master (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL CHECK (role IN ('master','sub')),
    credential_hash TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE gm_session (
    id INTEGER PRIMARY KEY,
    gm_id INTEGER NOT NULL REFERENCES game_master(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    device_type TEXT NOT NULL CHECK (device_type IN ('phone','laptop')),
    paused INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE night (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('setup','joins_open','live','paused','ended','archived')),
    trading_closed INTEGER NOT NULL DEFAULT 0,
    length_minutes INTEGER NOT NULL,
    current_quarter INTEGER,
    started_at INTEGER,
    paused_at INTEGER,
    ended_at INTEGER,
    tick_count INTEGER NOT NULL DEFAULT 0,
    last_tick_at INTEGER,
    settings TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE night_pause (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL REFERENCES night(id),
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );

  CREATE TABLE player (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL REFERENCES night(id),
    display_name TEXT NOT NULL COLLATE NOCASE,
    avatar_path TEXT,
    color TEXT,
    ticker TEXT NOT NULL COLLATE NOCASE,
    reroll_tokens_left INTEGER NOT NULL,
    got_stake INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    left_at INTEGER,
    UNIQUE (night_id, display_name),
    UNIQUE (night_id, ticker)
  );
  CREATE TABLE device (
    id INTEGER PRIMARY KEY,
    player_id INTEGER NOT NULL REFERENCES player(id),
    token_hash TEXT NOT NULL UNIQUE,
    approved_by_gm_id INTEGER REFERENCES game_master(id),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE device_request (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL REFERENCES night(id),
    player_id INTEGER REFERENCES player(id),
    token_hash TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('rejoin','late_join')),
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE rule_entry (
    id INTEGER PRIMARY KEY,
    game_name TEXT,
    title TEXT NOT NULL,
    body_markdown TEXT NOT NULL DEFAULT '',
    link TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE library_game (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    min_players INTEGER NOT NULL,
    max_players INTEGER NOT NULL,
    default_duration REAL NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('competitive','team','coop')),
    rerolls_allowed INTEGER NOT NULL DEFAULT 0,
    sound_theme TEXT,
    rule_entry_id INTEGER REFERENCES rule_entry(id),
    icon TEXT,
    color TEXT
  );
  CREATE TABLE game_table (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL REFERENCES night(id),
    name TEXT NOT NULL,
    seats INTEGER NOT NULL,
    map_x REAL NOT NULL DEFAULT 0,
    map_y REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE game (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL REFERENCES night(id),
    library_game_id INTEGER REFERENCES library_game(id),
    name TEXT NOT NULL,
    table_id INTEGER REFERENCES game_table(id),
    mode TEXT NOT NULL CHECK (mode IN ('competitive','team','coop')),
    planned_start INTEGER,
    planned_duration_hours REAL,
    assigned_gm_id INTEGER REFERENCES game_master(id),
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','final','cancelled')),
    started_at INTEGER,
    ended_at INTEGER,
    paused_seconds INTEGER NOT NULL DEFAULT 0,
    actual_duration_hours REAL,
    rerolls_allowed INTEGER NOT NULL DEFAULT 0,
    coop_won INTEGER
  );
  CREATE TABLE game_participant (
    game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES player(id),
    team_label TEXT,
    seat_number INTEGER,
    placement INTEGER,
    dnf INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, player_id)
  );
  CREATE TABLE leader_tap (
    id INTEGER PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES game(id),
    player_id INTEGER NOT NULL REFERENCES player(id),
    gm_id INTEGER REFERENCES game_master(id),
    night_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE adjustment (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL REFERENCES night(id),
    player_id INTEGER NOT NULL REFERENCES player(id),
    gold_h INTEGER NOT NULL,
    reason TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','late_join','espionage')),
    gm_id INTEGER REFERENCES game_master(id),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE reroll_use (
    id INTEGER PRIMARY KEY,
    player_id INTEGER NOT NULL REFERENCES player(id),
    game_id INTEGER NOT NULL REFERENCES game(id),
    gm_id INTEGER REFERENCES game_master(id),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE security (
    id TEXT NOT NULL,
    night_id INTEGER NOT NULL REFERENCES night(id),
    kind TEXT NOT NULL CHECK (kind IN ('player','index','crypto','event','dead')),
    player_id INTEGER REFERENCES player(id),
    ticker TEXT NOT NULL,
    price REAL NOT NULL,
    gm_offset REAL NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (night_id, id)
  );
  CREATE TABLE price (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL,
    security_id TEXT NOT NULL,
    tick INTEGER NOT NULL,
    price REAL NOT NULL,
    fair REAL,
    target REAL,
    causes TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX price_by_sec ON price(night_id, security_id, tick);
  CREATE TABLE impulse (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL,
    security_id TEXT NOT NULL,
    frac REAL NOT NULL,
    cause TEXT NOT NULL,
    move_baseline INTEGER NOT NULL DEFAULT 0,
    consumed_tick INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX impulse_pending ON impulse(night_id, consumed_tick);
  CREATE TABLE trade (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL REFERENCES player(id),
    security_id TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('buy','sell')),
    shares_h INTEGER NOT NULL,
    price REAL NOT NULL,
    cash_h INTEGER NOT NULL,
    fee_h INTEGER NOT NULL DEFAULT 0,
    basis_h INTEGER,
    forced INTEGER NOT NULL DEFAULT 0,
    tick INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE lot (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL REFERENCES player(id),
    security_id TEXT NOT NULL,
    shares_h INTEGER NOT NULL,
    cost_basis_h INTEGER NOT NULL,
    created_nms INTEGER NOT NULL,
    unlock_nms INTEGER NOT NULL
  );

  CREATE TABLE vote_round (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL REFERENCES night(id),
    quarter INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open','closed','resolved','void')),
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    drift TEXT,
    UNIQUE (night_id, quarter)
  );
  CREATE TABLE ballot (
    vote_round_id INTEGER NOT NULL REFERENCES vote_round(id),
    player_id INTEGER NOT NULL REFERENCES player(id),
    target_player_id INTEGER NOT NULL REFERENCES player(id),
    weight REAL NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (vote_round_id, player_id)
  );
  CREATE TABLE bounty_payout (
    id INTEGER PRIMARY KEY,
    vote_round_id INTEGER NOT NULL REFERENCES vote_round(id),
    player_id INTEGER NOT NULL REFERENCES player(id),
    gold_h INTEGER NOT NULL,
    paid_at INTEGER NOT NULL
  );
  CREATE TABLE mood_reading (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL REFERENCES night(id),
    player_id INTEGER NOT NULL REFERENCES player(id),
    gm_id INTEGER REFERENCES game_master(id),
    mood INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 5),
    self_assessment INTEGER NOT NULL CHECK (self_assessment BETWEEN 1 AND 5),
    tick INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE challenge (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL REFERENCES night(id),
    player_id INTEGER REFERENCES player(id),
    gm_id INTEGER REFERENCES game_master(id),
    text TEXT NOT NULL,
    reward TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (status IN ('sent','read','accepted','rejected','succeeded','failed','reassigned')),
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE TABLE achievement (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL REFERENCES night(id),
    player_id INTEGER NOT NULL REFERENCES player(id),
    type TEXT NOT NULL,
    game_id INTEGER REFERENCES game(id),
    gold_h INTEGER NOT NULL DEFAULT 0,
    gold_hidden INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE (night_id, player_id, type)
  );
  CREATE TABLE sound (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('ambient','cue','soundboard')),
    theme TEXT
  );
  CREATE TABLE notification (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL REFERENCES night(id),
    target TEXT NOT NULL,
    message TEXT NOT NULL,
    sent_by_gm_id INTEGER REFERENCES game_master(id),
    read_by TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE minter_state (
    player_id INTEGER NOT NULL REFERENCES player(id),
    night_id INTEGER NOT NULL REFERENCES night(id),
    minted REAL NOT NULL DEFAULT 0,
    currency REAL NOT NULL DEFAULT 0,
    tiers TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, night_id)
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    night_id INTEGER,
    gm_id INTEGER REFERENCES game_master(id),
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    before TEXT,
    after TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE feed_event (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL REFERENCES night(id),
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    gm_only INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE standings_snapshot (
    id INTEGER PRIMARY KEY,
    night_id INTEGER NOT NULL REFERENCES night(id),
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  /* 2 — key/value bookkeeping (e.g. one-time library seed) */ `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  /* 3 — pause countdown */ `
  ALTER TABLE night ADD COLUMN pause_until INTEGER;
  `,
  /* 4 — espionage bookkeeping */ `
  ALTER TABLE challenge ADD COLUMN reveal_at INTEGER;
  ALTER TABLE challenge ADD COLUMN revealed INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE challenge ADD COLUMN reassigned_from INTEGER;
  ALTER TABLE challenge ADD COLUMN peek_target INTEGER;
  ALTER TABLE challenge ADD COLUMN read_at INTEGER;
  `,
  /* 5 — seating, minter bookkeeping, sound metadata */ `
  CREATE TABLE seat_assignment (
    night_id INTEGER NOT NULL REFERENCES night(id),
    table_id INTEGER NOT NULL REFERENCES game_table(id) ON DELETE CASCADE,
    seat INTEGER NOT NULL,
    player_id INTEGER NOT NULL REFERENCES player(id),
    PRIMARY KEY (night_id, player_id),
    UNIQUE (table_id, seat)
  );
  ALTER TABLE minter_state ADD COLUMN taps INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sound ADD COLUMN mime TEXT;
  ALTER TABLE sound ADD COLUMN created_at INTEGER;
  `,
  /* 6 — finale: server-timed recap, then phones unlock */ `
  ALTER TABLE night ADD COLUMN recap_until INTEGER;
  ALTER TABLE night ADD COLUMN recap_done INTEGER NOT NULL DEFAULT 0;
  `,
];
