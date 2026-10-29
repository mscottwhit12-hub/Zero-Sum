/** Shapes sent by the server (see packages/server/src/services/views.ts). */
export interface NightInfo {
  id: number;
  name: string;
  date: string;
  status: 'setup' | 'joins_open' | 'live' | 'paused' | 'ended' | 'archived';
  tradingClosed: boolean;
  lengthMinutes: number;
  nightMs: number;
  currentQuarter: number | null;
  quarters: { n: number; startMin: number; endMin: number; windowEndMin: number }[];
  tickSeconds: number;
  serverTime: number;
  pauseUntil: number | null;
  recapUntil: number | null;
  recapDone: boolean;
  rules: { feeFrac: number; investCapH: number; lockoutMinutes: number; minTradeH: number; endSellProfitFeeFrac: number };
}
export interface PlayerInfo {
  id: number;
  displayName: string;
  ticker: string;
  color: string | null;
  avatarPath: string | null;
  left: boolean;
}
export interface Standing {
  playerId: number;
  netWorthH: number;
  rank: number;
}
export interface Security {
  id: string;
  kind: 'player' | 'index' | 'crypto' | 'event' | 'dead';
  ticker: string;
  playerId: number | null;
  price: number;
  history: number[];
}
export interface GameInfo {
  id: number;
  name: string;
  mode: 'competitive' | 'team' | 'coop';
  status: 'scheduled' | 'active' | 'final' | 'cancelled';
  color: string | null;
  plannedStart: number | null;
  plannedDurationHours: number | null;
  startedAt: number | null;
  endedAt: number | null;
  hours: number | null;
  rerollsAllowed: boolean;
  participants: { playerId: number; placement: number | null; dnf: boolean; team: string | null }[];
  leaderId: number | null;
  tableId: number | null;
  leadMode: LeadMode;
  leadLabel: string | null;
  scores: Record<number, number>;
  leadFixed: boolean;
  /** GM board module key (packages/client/src/gm/boards/<key>); null = generic score entry. */
  board: string | null;
}
export type LeadMode = 'high' | 'low' | 'manual';
export interface FeedItem {
  id: number;
  type: string;
  message: string;
  data: Record<string, unknown>;
  gmOnly: boolean;
  createdAt: number;
}
export interface LibraryGame {
  id: number;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  defaultDuration: number;
  mode: 'competitive' | 'team' | 'coop';
  rerollsAllowed: boolean;
  soundTheme: string | null;
  ruleEntryId: number | null;
  icon: string | null;
  color: string | null;
  leadMode: LeadMode | null;
  leadLabel: string | null;
}
export interface LedgerRow {
  playerId: number;
  stakeH: number;
  resultsH: number;
  adjustmentsH: number;
  bountiesH: number;
  achievementsH: number;
  tradeFlowH: number;
  cashH: number;
  netWorthH: number;
}
export interface PublicState {
  night: NightInfo | null;
  players: PlayerInfo[];
  standings: Standing[];
  market: Security[];
  games: GameInfo[];
  feed: FeedItem[];
  vote?: { quarter: number; open: boolean; windowEndsNms: number | null } | null;
  minter?: { leaderboard: { playerId: number; minted: number }[] };
  finale?: Finale | null;
}
export type RecapSlide =
  | { id: 'top_trade' | 'best_investment' | 'worst_investment'; playerId: number; ticker: string; profitH: number }
  | { id: 'most_predicted'; playerId: number; votes: number }
  | { id: 'long_reigns'; count: number }
  | { id: 'mood'; cheeriest: number; moodiest: number }
  | { id: 'hours'; leaders: { playerId: number; hours: number }[] }
  | { id: 'espionage'; sent: number; accepted: number; completed: number; exposed: number }
  | { id: 'minter'; playerId: number; minted: number }
  | { id: 'achievements'; items: { playerId: number; type: string }[] };
export interface Finale {
  podium: { playerId: number; goldH: number; rank: number }[];
  slides: RecapSlide[];
  timing: { collapseSeconds: number; podiumStepSeconds: number; recapSlideSeconds: number };
}
export interface StatementTrade {
  at: number;
  side: 'buy' | 'sell' | 'short' | 'cover';
  ticker: string;
  sharesH: number;
  price: number;
  cashH: number;
  feeH: number;
  profitH: number | null;
  forced: boolean;
}
export interface Statement {
  night: { name: string; date: string };
  player: { id: number; displayName: string; ticker: string };
  goldH: number;
  rank: number | null;
  players: number;
  rankStart: number | null;
  rankBest: number | null;
  bestTrade: StatementTrade | null;
  worstTrade: StatementTrade | null;
  tradingResultH: number;
  correctVotes: number;
  votesCast: number;
  achievements: string[];
  nftsMinted: number;
  trades: StatementTrade[];
}
export interface SeatingTable {
  id: number;
  name: string;
  seats: number;
  x: number;
  y: number;
  /** size as fractions of the floor-plan width */
  w: number;
  h: number;
  assignments: { seat: number; playerId: number }[];
  gameId: number | null;
}
export interface SoundInfo {
  id: number;
  name: string;
  kind: 'ambient' | 'cue' | 'soundboard';
  theme: string | null;
  url: string;
}
export interface Ambient {
  url: string;
  theme: string;
  gameId: number;
}
export interface TvState extends PublicState {
  tv?: { seating: SeatingTable[]; ambient: Ambient | null };
}
export interface RuleEntry {
  id: number;
  gameName: string | null;
  title: string;
  body: string;
  link: string | null;
  updatedAt: number;
  games: { id: number; name: string }[];
}
export interface GmExtras {
  ledger: LedgerRow[];
  stocks: { securityId: string; gmOffset: number; moodTerm: number }[];
  indexTerms?: { growth: number; drop: number; extra: number };
  settings: { resolved: Record<string, unknown>; overrides: Record<string, unknown> };
  library: LibraryGame[];
  hours: Record<number, number>;
  tickCount: number;
  feed: FeedItem[];
  requests: PendingRequest[];
  vote: (VoteInfo & { ballotsCast: number; eligible: number }) | null;
  mood: { playerId: number; mood: number; selfAssessment: number; bias: number }[];
  challenges: GmChallenge[];
  notifications: { id: number; to: string; message: string; readCount: number; createdAt: number }[];
  rerolls: Record<number, number>;
  seating: SeatingTable[];
  /** Board settings set by the Master: board key -> setting -> value (defaults come from each board's def). */
  boardSettings: Record<string, Record<string, number>>;
  sounds: SoundInfo[];
  ambient: { current: Ambient | null; off: boolean };
  prompts: { closeTradingAt: number | null; endNight: boolean; overrun: { gameId: number; name: string; extendMinutes: number } | null };
  tips: { id: number; playerId: number; hintId: string; tier: TipTier; source: string; costH: number; nightMs: number; createdAt: number; read: boolean }[];
  handicap: {
    autoEnabled: boolean;
    intervalMinutes: number;
    nextEvalNms: number;
    players: { playerId: number; auto: number; offset: number; effective: number; reasons: Record<string, unknown> | null; lastNms: number | null }[];
    log: { id: number; playerId: number; nightMs: number; auto: number; offset: number; effective: number; trigger: string; reasons: Record<string, unknown>; giftH: number; tips: string[] }[];
  };
}
export interface VoteInfo {
  quarter: number;
  open: boolean;
  windowEndsNms: number | null;
  quarterEndsNms: number | null;
  myTarget: number | null;
}
export type RewardType = 'gold' | 'reroll' | 'peek' | 'dead_clue' | 'custom' | 'hint' | 'wiretap';
export type TipTier = 'common' | 'rarer' | 'rarest';
export interface Reward {
  type: RewardType;
  gold?: number;
  text?: string;
  tier?: TipTier;
  /** wiretap: one random message from any chat, or between two players the holder picks */
  mode?: 'any' | 'pair';
}
export interface ChatMessage {
  id: number;
  threadId: number;
  playerId: number;
  text: string;
  createdAt: number;
}
export interface ChatThread {
  id: number;
  kind: 'dm' | 'group';
  name: string | null;
  members: number[];
  last: ChatMessage | null;
  unread: number;
  count: number;
}
export interface WiretapResult {
  message: ChatMessage;
  thread: { kind: 'dm' | 'group'; name: string | null; members: number[] };
}
export type ChallengeStatus = 'sent' | 'read' | 'accepted' | 'rejected' | 'succeeded' | 'failed' | 'reassigned';
export interface GmChallenge {
  id: number;
  playerId: number;
  status: ChallengeStatus;
  text: string;
  reward: Reward;
  createdAt: number;
  reassignedFrom: number | null;
}
export interface PeekTrade {
  securityId: string;
  side: string;
  sharesH: number;
  price: number;
  createdAt: number;
}
export interface MyChallenge {
  id: number;
  status: ChallengeStatus;
  text: string;
  reward: Reward;
  createdAt: number;
  peek: { used: boolean; targetId: number | null; trades: PeekTrade[] } | null;
  wiretap: { mode: 'any' | 'pair'; result: WiretapResult | null } | null;
}
export interface WhoAmI {
  name: string;
  role: 'master' | 'sub';
  deviceType: 'phone' | 'laptop';
  paused: boolean;
}
export interface GmState extends PublicState {
  whoami?: WhoAmI;
  /** Absent when this device is remotely paused (it then gets the public view only). */
  gm?: GmExtras;
}

export interface Holding {
  securityId: string;
  /** Short position (inverse share): gains when the price falls; loss capped at the stake. */
  short?: boolean;
  sharesH: number;
  costBasisH: number;
  valueH: number;
  lots: { sharesH: number; unlockNms: number; entry?: number }[];
}
export interface Me {
  id: number;
  displayName: string;
  ticker: string;
  cashH: number;
  netWorthH: number;
  rank: number | null;
  rerollsLeft: number;
  capRemainingH: number;
  holdings: Holding[];
  achievements: { type: string; createdAt: number }[];
  messages: { id: number; message: string; createdAt: number; read: boolean }[];
  /** Unread player-chat messages. */
  chatUnread: number;
  trades: { securityId: string; side: 'buy' | 'sell'; short?: number; sharesH: number; price: number; cashH: number; feeH: number; forced: number; createdAt: number }[];
  vote: VoteInfo | null;
  challenges: MyChallenge[];
  tips: { id: number; hintId: string; vars: Record<string, string | number>; createdAt: number; read: boolean }[];
  gifts: { id: number; goldH: number; createdAt: number; read: boolean }[];
  tipShop: { buy: Record<TipTier, number> | null; tradeIn: { tokens: number; nextAtNms: number | null } | null };
}
export interface PlayerState extends PublicState {
  me?: Me;
}
export interface PendingRequest {
  id: number;
  kind: 'rejoin' | 'late_join';
  playerId: number | null;
  displayName: string;
  ticker: string | null;
  createdAt: number;
}
