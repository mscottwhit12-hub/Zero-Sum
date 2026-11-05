/**
 * Top-down pictures for table props (original simple drawings; no game names, logos or box art).
 * Each is SVG markup for a viewBox of (100 × aspect) by 100, aspect from PROP_KINDS in the engine.
 * Constant strings only (rendered with {@html}); nothing here comes from users.
 */
const hex = (cx: number, cy: number, r: number, fill: string) => {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return `<polygon points="${pts}" fill="${fill}" stroke="#f3e7c4" stroke-width="0.8"/>`;
};
const die = (x: number, y: number, s: number, n: number) => {
  const p = (dx: number, dy: number) => `<circle cx="${x + dx * s}" cy="${y + dy * s}" r="${s * 0.09}" fill="#222"/>`;
  const at: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.27, 0.27], [0.73, 0.73]],
    3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
    5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
    6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
  };
  return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.18}" fill="#fbfaf5" stroke="#999" stroke-width="0.8"/>${(at[n] ?? []).map(([a, b]) => p(a, b)).join('')}`;
};
const chipStack = (cx: number, cy: number, r: number, c: string) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" stroke="#0005" stroke-width="1"/>` +
  Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI / 4) * i;
    return `<rect x="${cx + Math.cos(a) * r * 0.78 - r * 0.1}" y="${cy + Math.sin(a) * r * 0.78 - r * 0.1}" width="${r * 0.2}" height="${r * 0.2}" fill="#fff" transform="rotate(${(a * 180) / Math.PI} ${cx + Math.cos(a) * r * 0.78} ${cy + Math.sin(a) * r * 0.78})"/>`;
  }).join('') +
  `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="none" stroke="#fff8" stroke-width="1"/>`;
const card = (x: number, y: number, w: number, h: number, fill: string, inner = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.1}" fill="${fill}" stroke="#0004" stroke-width="0.8"/>${inner}`;
const cardBack = (x: number, y: number, w: number, h: number) =>
  card(x, y, w, h, '#24345c', `<rect x="${x + w * 0.12}" y="${y + h * 0.1}" width="${w * 0.76}" height="${h * 0.8}" rx="${w * 0.06}" fill="none" stroke="#c9b26b" stroke-width="1"/><path d="M${x + w * 0.12} ${y + h * 0.1} L${x + w * 0.88} ${y + h * 0.9} M${x + w * 0.88} ${y + h * 0.1} L${x + w * 0.12} ${y + h * 0.9}" stroke="#c9b26b55" stroke-width="1"/>`);

/** Track squares around the edge of a square board (n per side), coloured by `colorAt`. */
const ring = (n: number, colorAt: (i: number) => string, inset = 2, size = 96) => {
  const s = size / n;
  let out = '';
  for (let i = 0; i < n * 4 - 4; i++) {
    const side = Math.floor(i / (n - 1));
    const k = i % (n - 1);
    const [x, y] =
      side === 0 ? [inset + k * s, inset] : side === 1 ? [inset + (n - 1) * s, inset + k * s] : side === 2 ? [inset + (n - 1 - k) * s, inset + (n - 1) * s] : [inset, inset + (n - 1 - k) * s];
    out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" fill="${colorAt(i)}" stroke="#5555" stroke-width="0.4"/>`;
  }
  return out;
};

const ART: Record<string, string> = {
  'board-risk':
    `<rect width="150" height="100" rx="5" fill="#2f6582"/>` +
    `<path d="M14 18 C30 8 48 14 46 30 C44 44 30 46 24 40 C14 38 8 28 14 18Z" fill="#c9b26b"/>` +
    `<path d="M34 52 C44 48 50 60 46 74 C42 88 34 90 32 78 C28 66 28 56 34 52Z" fill="#8fae6b"/>` +
    `<path d="M66 16 C78 10 90 16 86 26 C80 32 70 30 66 24Z" fill="#9b8bb5"/>` +
    `<path d="M68 36 C80 32 90 40 86 58 C82 74 72 76 68 62 C64 52 62 42 68 36Z" fill="#c98f5a"/>` +
    `<path d="M92 14 C114 6 140 14 138 32 C134 46 114 50 100 42 C90 36 86 22 92 14Z" fill="#c46b6b"/>` +
    `<path d="M116 66 C128 62 138 70 134 82 C130 90 118 90 114 82 C110 74 110 68 116 66Z" fill="#6f9a8f"/>` +
    [[24, 26, '#d33'], [38, 66, '#33d'], [76, 50, '#2a2'], [112, 28, '#dd3'], [124, 76, '#a3d'], [76, 22, '#222']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${c}" stroke="#fff" stroke-width="0.8"/>`).join(''),
  'board-catan': (() => {
    const r = 10.2;
    const colors = ['#8a8f98', '#9cc25a', '#4f7f3a', '#e1c35a', '#b5653b', '#9cc25a', '#e1c35a', '#4f7f3a', '#d9c79a', '#8a8f98', '#4f7f3a', '#b5653b', '#e1c35a', '#9cc25a', '#b5653b', '#e1c35a', '#4f7f3a', '#9cc25a', '#8a8f98'];
    const rows = [3, 4, 5, 4, 3];
    const w = Math.sqrt(3) * r;
    let i = 0;
    let out = `<polygon points="55,1 104,25 104,75 55,99 6,75 6,25" fill="#3b78a8"/>`;
    rows.forEach((n, ri) => {
      for (let k = 0; k < n; k++) out += hex(55 - ((n - 1) * w) / 2 + k * w, 50 + (ri - 2) * r * 1.5, r * 0.98, colors[i++]!);
    });
    return out;
  })(),
  'board-monopoly':
    `<rect width="100" height="100" rx="2" fill="#d6e6cf"/>` +
    ring(11, (i) => {
      const c = ['#8b5a3c', '#9fd3ea', '#d36fa8', '#f0a04b', '#d9443e', '#f2d33c', '#3f9a54', '#2f4fa0'];
      return i % 10 === 0 ? '#eee' : i % 5 === 2 ? '#e8e2d0' : c[Math.floor(i / 5) % 8]!;
    }) +
    `<rect x="30" y="38" width="40" height="24" rx="2" fill="#c7383a" transform="rotate(-35 50 50)"/>`,
  'board-clue':
    `<rect width="100" height="100" rx="2" fill="#e8d9b0"/>` +
    `<g stroke="#bda76d" stroke-width="0.4">${Array.from({ length: 20 }, (_, i) => `<line x1="${i * 5}" y1="0" x2="${i * 5}" y2="100"/><line x1="0" y1="${i * 5}" x2="100" y2="${i * 5}"/>`).join('')}</g>` +
    [[3, 3, 28, 22, '#a9785a'], [36, 3, 28, 18, '#7f9a74'], [69, 3, 28, 26, '#8e7aa8'], [3, 34, 22, 30, '#b5884e'], [74, 38, 23, 24, '#6d8fa3'], [3, 70, 30, 27, '#9a6e6e'], [40, 76, 24, 21, '#79926b'], [69, 70, 28, 27, '#a58b5c'], [36, 36, 28, 28, '#c9b88a']]
      .map(([x, y, w, h, c]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}" stroke="#5b4a2a" stroke-width="0.8"/>`)
      .join(''),
  'board-scrabble': (() => {
    let out = `<rect width="100" height="100" rx="2" fill="#ece3cc"/>`;
    const s = 96 / 15;
    for (let r = 0; r < 15; r++)
      for (let c = 0; c < 15; c++) {
        const d = Math.abs(7 - r) + Math.abs(7 - c);
        const fill = (r % 7 === 0 && c % 7 === 0 && !(r === 7 && c === 7)) ? '#c95b4b' : r === c || r + c === 14 ? (d > 4 ? '#e7a7a0' : '#ece3cc') : (r * 3 + c * 5) % 11 === 0 ? '#5f86b5' : (r + c * 2) % 13 === 0 ? '#a9c7e3' : '#ece3cc';
        out += `<rect x="${2 + c * s}" y="${2 + r * s}" width="${s - 0.4}" height="${s - 0.4}" fill="${fill}"/>`;
      }
    for (const [r, c] of [[7, 4], [7, 5], [7, 6], [7, 7], [7, 8], [5, 6], [6, 6], [8, 6]]) out += `<rect x="${2 + c! * s + 0.4}" y="${2 + r! * s + 0.4}" width="${s - 1.2}" height="${s - 1.2}" rx="0.8" fill="#f6ecd1" stroke="#a88d5a" stroke-width="0.4"/>`;
    return out;
  })(),
  'board-ttr':
    `<rect width="150" height="100" rx="4" fill="#e7dcc0"/>` +
    `<path d="M0 70 C20 60 30 80 50 74 S80 90 100 82 S130 92 150 86 L150 100 L0 100Z" fill="#a9c4d6"/>` +
    [['M18 22 L48 30', '#d9443e'], ['M48 30 L80 20', '#3f6fd0'], ['M80 20 L118 30', '#3f9a54'], ['M118 30 L134 56', '#f2d33c'], ['M48 30 L56 58', '#8a8f98'], ['M56 58 L96 54', '#e48a2e'], ['M96 54 L134 56', '#222'], ['M18 22 L22 54', '#a64fb0'], ['M22 54 L56 58', '#fff']]
      .map(([d, c]) => `<path d="${d}" stroke="${c}" stroke-width="3.2" stroke-dasharray="6 1.6" fill="none"/>`)
      .join('') +
    [[18, 22], [48, 30], [80, 20], [118, 30], [134, 56], [56, 58], [96, 54], [22, 54]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="#7a2e2e" stroke="#fff" stroke-width="0.8"/>`).join(''),
  'board-sorry':
    `<rect width="100" height="100" rx="2" fill="#e9f0f4"/>` +
    ring(16, (i) => (i % 15 === 4 ? '#ffd' : '#fff')) +
    [[14, 14, '#d9443e'], [86, 14, '#3f6fd0'], [86, 86, '#f2d33c'], [14, 86, '#3f9a54']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="8" fill="${c}" stroke="#0003"/>`).join('') +
    `<path d="M20 8 L20 36 M92 20 L64 20 M80 92 L80 64 M8 80 L36 80" stroke-width="5" stroke-linecap="round" stroke="#0002"/>`,
  'board-parcheesi':
    `<rect width="100" height="100" rx="2" fill="#f1e4c8"/>` +
    [[0, 0, '#d9443e'], [62, 0, '#3f6fd0'], [62, 62, '#f2d33c'], [0, 62, '#3f9a54']].map(([x, y, c]) => `<rect x="${x}" y="${y}" width="38" height="38" fill="${c}" stroke="#0003"/>`).join('') +
    `<g fill="#fff" stroke="#9b8a66" stroke-width="0.4">${Array.from({ length: 8 }, (_, i) => `<rect x="38" y="${i * 4.75}" width="8" height="4.75"/><rect x="54" y="${i * 4.75}" width="8" height="4.75"/><rect x="38" y="${62 + i * 4.75}" width="8" height="4.75"/><rect x="54" y="${62 + i * 4.75}" width="8" height="4.75"/><rect y="38" x="${i * 4.75}" height="8" width="4.75"/><rect y="54" x="${i * 4.75}" height="8" width="4.75"/><rect y="38" x="${62 + i * 4.75}" height="8" width="4.75"/><rect y="54" x="${62 + i * 4.75}" height="8" width="4.75"/>`).join('')}</g>` +
    `<rect x="38" y="38" width="24" height="24" fill="#c9b26b"/><path d="M38 38 L62 62 M62 38 L38 62" stroke="#8a733a" stroke-width="0.8"/>`,
  'board-uno':
    cardBack(14, 12, 54, 78) + cardBack(10, 10, 54, 78) +
    card(88, 12, 54, 78, '#d9443e', `<ellipse cx="115" cy="51" rx="18" ry="30" transform="rotate(25 115 51)" fill="#fff"/><text x="115" y="61" text-anchor="middle" font-size="30" font-family="sans-serif" font-weight="700" fill="#d9443e">7</text>`),
  'board-yahtzee':
    die(6, 10, 22, 6) + die(32, 6, 22, 6) + die(58, 12, 22, 3) + die(16, 40, 22, 6) + die(44, 38, 22, 5) +
    `<rect x="90" y="8" width="54" height="84" rx="2" fill="#fffef6" stroke="#bbb"/>` +
    Array.from({ length: 12 }, (_, i) => `<line x1="94" y1="${18 + i * 6}" x2="140" y2="${18 + i * 6}" stroke="#9ab" stroke-width="0.6"/>`).join('') +
    `<line x1="124" y1="12" x2="124" y2="88" stroke="#c88" stroke-width="0.6"/>`,
  'board-poker':
    `<ellipse cx="80" cy="50" rx="78" ry="48" fill="#6b4a2b"/><ellipse cx="80" cy="50" rx="72" ry="42" fill="#2f7a4f"/>` +
    [0, 1, 2, 3, 4].map((i) => card(43 + i * 15, 36, 13, 19, i < 3 ? '#fff' : '#24345c', i < 3 ? `<text x="${49.5 + i * 15}" y="${50}" text-anchor="middle" font-size="9" font-family="sans-serif" fill="${i === 1 ? '#c22' : '#222'}">${['A', 'K', '9'][i]}</text>` : '')).join('') +
    chipStack(28, 50, 7, '#c22') + chipStack(132, 50, 7, '#225') + chipStack(80, 76, 6, '#222') + chipStack(80, 22, 6, '#c22'),
  chips: chipStack(30, 52, 24, '#c62f2f') + chipStack(80, 40, 24, '#2c46a5') + chipStack(112, 66, 22, '#222'),
  cards: cardBack(4, 6, 64, 90) + cardBack(2, 4, 64, 90),
  dice: die(10, 18, 66, 5) + `<g transform="rotate(14 136 52)">${die(103, 19, 66, 3)}</g>`,
  dealer: `<circle cx="50" cy="50" r="46" fill="#fdfcf6" stroke="#999" stroke-width="2"/><circle cx="50" cy="50" r="36" fill="none" stroke="#c9b26b" stroke-width="2"/><text x="50" y="64" text-anchor="middle" font-size="40" font-family="serif" font-weight="700" fill="#222">D</text>`,
  'beer-can':
    `<circle cx="50" cy="50" r="47" fill="#c9a43a"/><circle cx="50" cy="50" r="41" fill="#d8dadf"/><circle cx="50" cy="50" r="36" fill="#c4c7cd"/>` +
    `<ellipse cx="50" cy="34" rx="10" ry="7" fill="#999ca3"/><rect x="40" y="40" width="20" height="18" rx="9" fill="#b3b6bc" stroke="#888" stroke-width="1.5"/><circle cx="50" cy="66" r="3" fill="#999ca3"/>`,
  cup: `<circle cx="50" cy="50" r="47" fill="#c62f2f"/><circle cx="50" cy="50" r="42" fill="#f4efe9"/><circle cx="50" cy="50" r="37" fill="#d99a2b"/><circle cx="40" cy="40" r="8" fill="#f2c35caa"/>`,
  vape:
    `<rect x="4" y="22" width="250" height="56" rx="26" fill="#2b2d33"/><rect x="250" y="34" width="62" height="32" rx="14" fill="#55585f"/>` +
    `<rect x="40" y="40" width="80" height="20" rx="10" fill="#6aa7c9"/><circle cx="216" cy="50" r="7" fill="#7ef0b8"/>`,
  'cig-pack':
    `<rect x="2" y="2" width="62" height="96" rx="4" fill="#f4f2ec" stroke="#999" stroke-width="1"/><rect x="2" y="2" width="62" height="30" rx="4" fill="#b3302d"/>` +
    [10, 22, 34, 46].map((x) => `<circle cx="${x + 4}" cy="16" r="5" fill="#e3a65a" stroke="#a0662a" stroke-width="0.8"/>`).join('') +
    `<rect x="10" y="52" width="46" height="26" fill="none" stroke="#b3302d" stroke-width="1.5"/>`,
  cigarette:
    `<rect x="4" y="34" width="150" height="32" rx="6" fill="#e3a65a"/><rect x="150" y="34" width="420" height="32" fill="#fbfaf6" stroke="#ddd" stroke-width="1"/>` +
    `<rect x="560" y="34" width="34" height="32" rx="6" fill="#9a9a9a"/><rect x="578" y="38" width="12" height="24" rx="4" fill="#f06a2a"/>`,
  joint:
    `<path d="M6 44 L20 40 L380 22 C400 21 412 30 412 50 C412 70 400 79 380 78 L20 60 L6 56 C0 52 0 48 6 44Z" fill="#f2eee2" stroke="#cbbf9e" stroke-width="1.5"/>` +
    `<path d="M120 30 L130 70 M220 26 L230 74 M300 24 L310 76" stroke="#d9cfb2" stroke-width="1.5"/><circle cx="420" cy="50" r="22" fill="#5e5e5e"/><circle cx="426" cy="50" r="12" fill="#f06a2a"/>`,
  ashtray:
    `<circle cx="50" cy="50" r="46" fill="#9fb8c4aa" stroke="#6f8894" stroke-width="2"/><circle cx="50" cy="50" r="30" fill="#4b4b4b"/>` +
    [0, 120, 240].map((a) => `<rect x="44" y="0" width="12" height="16" rx="4" fill="#6f8894" transform="rotate(${a} 50 50)"/>`).join('') +
    `<rect x="36" y="44" width="34" height="9" rx="2" fill="#fbfaf6" transform="rotate(-20 50 50)"/><rect x="34" y="44" width="9" height="9" rx="2" fill="#e3a65a" transform="rotate(-20 50 50)"/>`,
};

export const propArt = (kind: string): string => ART[kind] ?? `<rect width="100" height="100" rx="10" fill="#888"/>`;
