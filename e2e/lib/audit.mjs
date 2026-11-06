/**
 * Layout audit for floor plans and the TV table close-up: finds things that cross, overlap or get cut off.
 * Run it on any page that shows a floor plan (GM Seating, GM board view, TV) and expect an empty list.
 *
 *   const problems = await layoutProblems(page);   // [] when clean, else short plain sentences
 *
 * Checks: page scrolls sideways; a table corner outside the plan; a table label crossing its (turned) table's edge,
 * cut off with "…", or on top of a seat; a prop off its table; a seat cut by the plan edge, sitting on another table,
 * or overlapping another table's seat; in the TV close-up the same for labels, props and seat names (also names
 * leaving the panel); Seating controls clipped or off screen.
 */
const AUDIT = () => {
  const out = [];
  const rotIn = (el) => { const m = /rotate\((-?[\d.]+)deg\)/.exec(el.getAttribute('style') ?? ''); return m ? +m[1] : 0; };
  const box = (cx, cy, w, h, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]); };
  const twQuad = (tw) => { const r = tw.getBoundingClientRect(); return box(r.left + r.width / 2, r.top + r.height / 2, tw.offsetWidth, tw.offsetHeight, rotIn(tw)); };
  const propQuad = (pr, tw) => { const r = tw.getBoundingClientRect(), d = rotIn(tw), a = d * Math.PI / 180; const lx = parseFloat(pr.style.left) - tw.offsetWidth / 2, ly = parseFloat(pr.style.top) - tw.offsetHeight / 2; return box(r.left + r.width / 2 + lx * Math.cos(a) - ly * Math.sin(a), r.top + r.height / 2 + lx * Math.sin(a) + ly * Math.cos(a), pr.offsetWidth, pr.offsetHeight, d + rotIn(pr)); };
  const quad = (el) => { const r = el.getBoundingClientRect(); return [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]]; };
  const inside = (pt, q, tol = 1.5) => { // convex quad, either winding
    let sgn = 0;
    for (let i = 0; i < 4; i++) { const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4]; const len = Math.hypot(bx - ax, by - ay); const c = ((bx - ax) * (pt[1] - ay) - (by - ay) * (pt[0] - ax)) / len; if (Math.abs(c) <= tol) continue; const s = Math.sign(c); if (sgn && s !== sgn) return false; sgn = s; }
    return true;
  };
  const rq = (r) => [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]];
  const hit = (a, b, pad = 0) => a.left < b.right - pad && b.left < a.right - pad && a.top < b.bottom - pad && b.top < a.bottom - pad;
  const name = (e) => (e.closest('.tw,.tv-table')?.querySelector('strong')?.textContent ?? '?').slice(0, 14);
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways ${document.documentElement.scrollWidth}>${innerWidth}`);
  // floor plans
  for (const fp of document.querySelectorAll('.fp')) {
    const fr = fp.getBoundingClientRect();
    const tws = [...fp.querySelectorAll('.tw')];
    const tq = tws.map(twQuad);
    tws.forEach((tw, i) => {
      const q = tq[i], n = name(tw);
      for (const p of q) if (p[0] < fr.left - 1 || p[0] > fr.right + 1 || p[1] < fr.top - 1 || p[1] > fr.bottom + 1) { out.push(`${n}: table corner outside plan`); break; }
      for (const l of tw.querySelectorAll('.lb strong, .lb .cnt, .plbl')) {
        const r = l.getBoundingClientRect(); if (!r.width) continue;
        if (!rq(r).every((p) => inside(p, q))) out.push(`${n}: label "${l.textContent.trim().slice(0, 20)}" crosses table edge`);
        if (l.scrollWidth > l.clientWidth + 1) out.push(`${n}: label "${l.textContent.trim().slice(0, 20)}" cut off (${l.scrollWidth}>${l.clientWidth})`);
        for (const st of tw.querySelectorAll('.seat')) if (hit(r, st.getBoundingClientRect(), 1)) out.push(`${n}: label overlaps seat ${st.textContent.trim()}`);
      }
      for (const pr of tw.querySelectorAll('.prop')) if (!propQuad(pr, tw).every((p) => inside(p, q, 2))) out.push(`${n}: prop ${pr.getAttribute('data-kind') ?? ''} off the table`);
      for (const st of tw.querySelectorAll('.seat')) { const r = st.getBoundingClientRect(); if (r.left < fr.left - 1 || r.right > fr.right + 1 || r.top < fr.top - 1 || r.bottom > fr.bottom + 1) out.push(`${n}: seat ${st.textContent.trim()} cut by plan edge`); }
    });
    // seats of one table over another table / its seats
    const seats = tws.flatMap((tw, i) => [...tw.querySelectorAll('.seat')].map((s) => ({ i, r: s.getBoundingClientRect(), n: name(tw) })));
    for (const a of seats) for (let j = 0; j < tws.length; j++) if (j !== a.i) { const c = [a.r.left + a.r.width / 2, a.r.top + a.r.height / 2]; if (inside(c, tq[j], -2)) out.push(`${a.n}: seat sits on table ${name(tws[j])}`); }
    for (let x = 0; x < seats.length; x++) for (let y = x + 1; y < seats.length; y++) if (seats[x].i !== seats[y].i && hit(seats[x].r, seats[y].r, 3)) out.push(`${seats[x].n}/${seats[y].n}: seats overlap`);
  }
  // TV close-up
  for (const tv of document.querySelectorAll('.tv-table')) {
    const tb = tv.querySelector('.tbl'); if (!tb) continue; const tr = tb.getBoundingClientRect();
    for (const l of tb.querySelectorAll(':scope > strong, :scope > .cnt')) { const r = l.getBoundingClientRect(); if (r.left < tr.left - 1 || r.right > tr.right + 1 || r.top < tr.top - 1 || r.bottom > tr.bottom + 1) out.push(`close-up: label "${l.textContent.trim().slice(0, 20)}" crosses table`); if (l.scrollWidth > l.clientWidth + 1) out.push(`close-up: label "${l.textContent.trim().slice(0, 20)}" cut off`); for (const lb of tv.querySelectorAll('.seat .lbl')) if (hit(r, lb.getBoundingClientRect(), 1)) out.push(`close-up: name "${l.textContent.trim().slice(0, 12)}" overlaps seat label ${lb.textContent}`); }
    const tq2 = rq(tr);
    for (const pr of tb.querySelectorAll('.prop')) if (!quad(pr).every((p) => inside(p, tq2, 2))) out.push('close-up: prop off the table');
    const lbls = [...tv.querySelectorAll('.seat .lbl')];
    const pr0 = tv.closest('.panel, section')?.getBoundingClientRect();
    for (const l of lbls) { if (l.scrollWidth > l.clientWidth + 1) out.push(`close-up: seat name ${l.textContent} cut off`); const r = l.getBoundingClientRect(); if (pr0 && (r.left < pr0.left || r.right > pr0.right)) out.push(`close-up: seat name ${l.textContent} outside panel`); }
    for (let x = 0; x < lbls.length; x++) for (let y = x + 1; y < lbls.length; y++) if (hit(lbls[x].getBoundingClientRect(), lbls[y].getBoundingClientRect(), 1)) out.push(`close-up: seat labels ${lbls[x].textContent}/${lbls[y].textContent} overlap`);
  }
  // GM controls: anything clipped sideways in the Seating panels
  for (const el of document.querySelectorAll('.panel .row, .palette, .colors, .prop-sel')) if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') out.push(`controls clipped: .${[...el.classList].join('.')}`);
  for (const el of document.querySelectorAll('.panel button, .panel input, .panel select')) { const r = el.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 1 || r.left < -1)) out.push(`control off screen: ${el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 15)}`); }
  return [...new Set(out)];
};

/** Problems on this page right now (empty list = clean). */
export const layoutProblems = (page) => page.evaluate(AUDIT);
