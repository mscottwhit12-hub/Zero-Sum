/**
 * Final Account Statement PDF (plain layout; spec §19.1 placeholder). Built with pdfkit's
 * built-in Helvetica (no font files, no network). Copy comes from copy/en.json via the caller.
 */
import PDFDocument from 'pdfkit';
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
        t.forced ? 'auto-sell' : t.side,
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
