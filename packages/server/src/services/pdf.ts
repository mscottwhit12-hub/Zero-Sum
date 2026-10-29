/**
 * Final Account Statement PDF (plain layout; spec §19.1 placeholder). Built with pdfkit's
 * built-in Helvetica (no font files, no network). Copy comes from copy/en.json via the caller.
 */
import PDFDocument from 'pdfkit';
import type { NightSummary } from './nightReport';
import type { Statement } from './recap';

const g = (h: number) => (h / 100).toFixed(2);
const sh = (h: number) => (h / 100).toFixed(2);

export function statementPdf(s: Statement, brand: { firm: string; title: string; footer: string }, achievementName: (type: string) => string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `${brand.title} — ${s.player.displayName}`, Author: brand.firm } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text(brand.firm);
    doc.font('Helvetica').fontSize(12).text(brand.title);
    doc.moveDown(0.3).fontSize(10).fillColor('#555').text(`${s.night.name} · ${s.night.date}`).fillColor('#000');
    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(13).text(`${s.player.displayName} (${s.player.ticker})`);
    doc.font('Helvetica').fontSize(11);
    const line = (k: string, v: string) => doc.text(`${k}: `, { continued: true }).font('Helvetica-Bold').text(v).font('Helvetica');
    line('Final gold', g(s.goldH));
    line('Final rank', s.rank == null ? '—' : `${s.rank} of ${s.players}`);
    if (s.rankStart != null) line('Rank movement', `${s.rankStart} -> ${s.rank ?? '—'} (best ${s.rankBest})`);
    line('Trading result', `${s.tradingResultH >= 0 ? '+' : ''}${g(s.tradingResultH)} gold`);
    if (s.bestTrade) line('Best trade', `${s.bestTrade.ticker} ${s.bestTrade.profitH! >= 0 ? '+' : ''}${g(s.bestTrade.profitH!)}`);
    if (s.worstTrade) line('Worst trade', `${s.worstTrade.ticker} ${g(s.worstTrade.profitH!)}`);
    line('Correct quarter picks', `${s.correctVotes} of ${s.votesCast}`);
    line('NFTs minted', s.nftsMinted.toLocaleString('en-US'));
    line('Achievements', s.achievements.length ? s.achievements.map(achievementName).join(', ') : 'none');
    const x = s.stats;
    line('Title', x.title);
    line('Gold from games', g(x.gameGoldH));
    line('Trades · fees paid', `${x.tradeCount} · ${g(x.feesH)}`);
    line('Biggest short win', x.bestShortH == null ? '—' : `+${g(x.bestShortH)}`);
    line('Biggest backer', x.biggestBacker ? `${x.biggestBacker.name} (${sh(x.biggestBacker.sharesH)} sh)` : '—');
    line('Bounties', g(x.bountiesH));
    line('Re-rolls used', String(x.rerollsUsed));
    line('NFT Minter rank', x.minterRank == null ? '—' : `#${x.minterRank}`);
    line('Playing · idle', `${x.playHours.toFixed(1)} h · ${x.idleHours.toFixed(1)} h`);
    line('Chat messages sent', String(x.chatMessages));

    chart(doc, 'Net worth across the night', x.netWorthLine.map((p) => p.v / 100));
    if (x.ownStock) chart(doc, `Your stock ${x.ownStock.ticker}: high ${x.ownStock.high.toFixed(2)} · low ${x.ownStock.low.toFixed(2)} · close ${x.ownStock.close.toFixed(2)}`, x.ownStock.line.map((p) => p.p));

    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Games', 48);
    doc.font('Helvetica').fontSize(10);
    if (!x.games.length) doc.text('No games.');
    for (const gm of x.games) doc.text(`${gm.name}: ${gm.dnf ? 'DNF' : gm.placement != null ? `${gm.placement} of ${gm.players}` : '—'} · +${g(gm.goldH)} gold`);

    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Trade history');
    doc.font('Helvetica').fontSize(9);
    const cols = [48, 110, 150, 205, 265, 320, 385, 450];
    const head = ['Time', 'Side', 'Stock', 'Shares', 'Price', 'Gold', 'Fee', 'Profit'];
    const row = (vals: string[], bold = false) => {
      if (doc.y > doc.page.height - 70) doc.addPage();
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      vals.forEach((v, i) => doc.text(v, cols[i]!, y, { width: (cols[i + 1] ?? 547) - cols[i]! - 4, lineBreak: false }));
      doc.x = 48;
      doc.y = y + doc.currentLineHeight(true) + 3;
    };
    row(head, true);
    if (!s.trades.length) doc.text('No trades.', 48);
    for (const t of s.trades) {
      row([
        new Date(t.at).toISOString().slice(11, 16),
        (t.forced ? 'auto-' : '') + t.side,
        t.ticker,
        sh(t.sharesH),
        t.price.toFixed(2),
        g(t.cashH),
        g(t.feeH),
        t.profitH == null ? '' : `${t.profitH >= 0 ? '+' : ''}${g(t.profitH)}`,
      ]);
    }
    doc.moveDown().fontSize(8).fillColor('#777').text(brand.footer, 48);
    doc.end();
  });
}

/** Simple line chart (title, frame, line, min/max labels). */
function chart(doc: PDFKit.PDFDocument, title: string, vals: number[]) {
  if (vals.length < 2) return;
  if (doc.y > doc.page.height - 190) doc.addPage();
  doc.moveDown().font('Helvetica-Bold').fontSize(11).text(title, 48);
  const x = 48;
  const y = doc.y + 6;
  const w = 499;
  const h = 110;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  doc.rect(x, y, w, h).strokeColor('#bbb').lineWidth(0.5).stroke();
  vals.forEach((v, i) => {
    const px = x + (i * w) / (vals.length - 1);
    const py = y + h - ((v - lo) / span) * h;
    if (i === 0) doc.moveTo(px, py);
    else doc.lineTo(px, py);
  });
  doc.strokeColor('#1b6b5d').lineWidth(1.5).stroke();
  doc.font('Helvetica').fontSize(8).fillColor('#555').text(hi.toFixed(2), x + w + 4, y - 4, { lineBreak: false }).text(lo.toFixed(2), x + w + 4, y + h - 6, { lineBreak: false }).fillColor('#000');
  doc.x = 48;
  doc.y = y + h + 8;
}

/** GM night summary: leaderboard, every game, biggest movers, index and COIN across the night, and titles. */
export function nightSummaryPdf(s: NightSummary, titles: { name: string; title: string }[], brand: { firm: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Night summary — ${s.night.name}`, Author: brand.firm } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(18).text(brand.firm);
    doc.font('Helvetica').fontSize(12).text(`Night summary · ${s.night.name} · ${s.night.date}`);
    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Final leaderboard');
    doc.font('Helvetica').fontSize(10);
    for (const r of s.leaderboard) doc.text(`${r.rank}. ${r.name} · ${g(r.goldH)} gold · ${titles.find((t) => t.name === r.name)?.title ?? ''}`);
    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Games');
    doc.font('Helvetica').fontSize(10);
    if (!s.games.length) doc.text('No games finished.');
    for (const gm of s.games) doc.text(`${gm.name} (${gm.hours.toFixed(2)} h): ${gm.places.map((p) => `${p.dnf ? 'DNF' : (p.placement ?? '—')} ${p.name} +${g(p.goldH)}`).join(' · ')}`);
    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Biggest movers');
    doc.font('Helvetica').fontSize(10);
    for (const m of s.movers) doc.text(`${m.ticker}: ${m.open.toFixed(2)} -> ${m.close.toFixed(2)} (${m.change >= 0 ? '+' : ''}${(m.change * 100).toFixed(1)}%)`);
    if (s.index) chart(doc, `Index (${s.index.ticker}) across the night`, s.index.line.map((p) => p.p));
    if (s.coin) chart(doc, `${s.coin.ticker} across the night`, s.coin.line.map((p) => p.p));
    doc.end();
  });
}
