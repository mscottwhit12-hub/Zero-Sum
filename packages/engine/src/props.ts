/**
 * Table props (QoL list): small top-down pictures that sit on a table and move with it. Positions are in the
 * table's own frame: x, y = centre as a fraction of the table's width/height from its centre (−0.5…0.5),
 * w = width as a fraction of the table's width; height = width ÷ aspect. Rotation in degrees (15° steps).
 */
export interface PropKind {
  id: string;
  label: string;
  group: 'board' | 'pieces' | 'drinks' | 'smoke';
  /** width ÷ height of the picture. */
  aspect: number;
  /** Default width as a fraction of the table's width. */
  w: number;
}

export const PROP_KINDS: PropKind[] = [
  { id: 'board-risk', label: 'World-map board', group: 'board', aspect: 1.5, w: 0.6 },
  { id: 'board-catan', label: 'Hex-island board', group: 'board', aspect: 1.1, w: 0.5 },
  { id: 'board-monopoly', label: 'Property-track board', group: 'board', aspect: 1, w: 0.45 },
  { id: 'board-clue', label: 'Mansion board', group: 'board', aspect: 1, w: 0.45 },
  { id: 'board-scrabble', label: 'Word-grid board', group: 'board', aspect: 1, w: 0.45 },
  { id: 'board-ttr', label: 'Railway-map board', group: 'board', aspect: 1.5, w: 0.6 },
  { id: 'board-sorry', label: 'Square race board', group: 'board', aspect: 1, w: 0.45 },
  { id: 'board-parcheesi', label: 'Cross race board', group: 'board', aspect: 1, w: 0.45 },
  { id: 'board-uno', label: 'Card piles', group: 'board', aspect: 1.6, w: 0.32 },
  { id: 'board-yahtzee', label: 'Dice and score pad', group: 'board', aspect: 1.5, w: 0.38 },
  { id: 'board-poker', label: 'Poker felt', group: 'board', aspect: 1.6, w: 0.6 },
  { id: 'chips', label: 'Chip stacks', group: 'pieces', aspect: 1.4, w: 0.14 },
  { id: 'cards', label: 'Deck of cards', group: 'pieces', aspect: 0.72, w: 0.08 },
  { id: 'dice', label: 'Pair of dice', group: 'pieces', aspect: 1.8, w: 0.1 },
  { id: 'dealer', label: 'Dealer button', group: 'pieces', aspect: 1, w: 0.06 },
  { id: 'beer-can', label: 'Beer can', group: 'drinks', aspect: 1, w: 0.07 },
  { id: 'cup', label: 'Party cup', group: 'drinks', aspect: 1, w: 0.08 },
  { id: 'vape', label: 'Vape', group: 'smoke', aspect: 3.2, w: 0.09 },
  { id: 'cig-pack', label: 'Cigarette pack', group: 'smoke', aspect: 0.66, w: 0.07 },
  { id: 'cigarette', label: 'Cigarette', group: 'smoke', aspect: 6, w: 0.09 },
  { id: 'joint', label: 'Joint', group: 'smoke', aspect: 4.5, w: 0.09 },
  { id: 'ashtray', label: 'Ashtray', group: 'smoke', aspect: 1, w: 0.09 },
];

export const propKind = (id: string) => PROP_KINDS.find((k) => k.id === id) ?? null;

/** The mini board a running game puts on its table (library board key → prop). */
export const BOARD_PROP: Record<string, string> = {
  risk: 'board-risk',
  catan: 'board-catan',
  monopoly: 'board-monopoly',
  clue: 'board-clue',
  scrabble: 'board-scrabble',
  'ticket-to-ride': 'board-ttr',
  'ticket-to-ride-europe': 'board-ttr',
  sorry: 'board-sorry',
  parcheesi: 'board-parcheesi',
  uno: 'board-uno',
  yahtzee: 'board-yahtzee',
  poker: 'board-poker',
};

export interface PropPlace {
  x: number;
  y: number;
  w: number;
  rotation: number;
}

/**
 * Keep a prop on its table: shrink it until its turned outline fits, then slide its centre inside.
 * `tw`, `th` = table width and height in the same units (only the ratio matters).
 */
export function fitProp(kind: PropKind, p: PropPlace, tw: number, th: number): PropPlace {
  const a = (p.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  let w = Math.min(Math.max(0.02, p.w), 1);
  const half = (wf: number) => {
    const pw = wf * tw;
    const ph = pw / kind.aspect;
    return { hx: (pw * c + ph * s) / 2, hy: (pw * s + ph * c) / 2 };
  };
  let h = half(w);
  const k = Math.min(1, (tw / 2) / h.hx, (th / 2) / h.hy);
  if (k < 1) {
    w *= k;
    h = half(w);
  }
  const clamp = (v: number, m: number) => Math.min(m, Math.max(-m, v));
  return { x: clamp(p.x, 0.5 - h.hx / tw), y: clamp(p.y, 0.5 - h.hy / th), w, rotation: p.rotation };
}

/** Table colours offered on the GM Seating screen (any #rrggbb is accepted; null = the theme's own). */
export const TABLE_COLORS: { id: string; label: string }[] = [
  { id: '#1f6b3a', label: 'Green felt' },
  { id: '#1d4f8c', label: 'Blue felt' },
  { id: '#8c1d2a', label: 'Red felt' },
  { id: '#5b2a86', label: 'Purple felt' },
  { id: '#7a4a24', label: 'Wood' },
  { id: '#c9a46a', label: 'Light wood' },
  { id: '#222222', label: 'Black' },
  { id: '#e8e4dc', label: 'White' },
];
/** A clean table colour: '#rrggbb' lower case, or null. */
export function cleanTableColor(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
}
/** Black or white text, whichever reads on `hex`. */
export function inkOn(hex: string): '#000' | '#fff' {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000' : '#fff';
}
