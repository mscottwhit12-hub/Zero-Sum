/**
 * App open/close transition (port of the mockup's Web Animations code): the app zooms out of the tapped icon and
 * back into it; home scales behind it; the dock slides. Pure presentation: nothing here touches app state.
 */
import type { TransitionConfig } from 'svelte/transition';

let origin = '50% 50%';

/** Remember where the tapped icon is (relative to the stage) so the app can grow from / shrink into it. */
export function setOrigin(e: Event) {
  const el = (e.currentTarget as HTMLElement | null)?.querySelector('.ic');
  const stage = document.querySelector('.phone .stage');
  if (!el || !stage) return;
  const r = el.getBoundingClientRect();
  const st = stage.getBoundingClientRect();
  origin = `${r.left + r.width / 2 - st.left}px ${r.top + r.height / 2 - st.top}px`;
}

/** cubic-bezier(.2,.8,.2,1), the mockup's easing. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  return (x: number) => {
    if (x <= 0 || x >= 1) return x;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 20; i++) {
      const cx = 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
      if (Math.abs(cx - x) < 1e-4) break;
      if (cx < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  };
}
const EASE = bezier(0.2, 0.8, 0.2, 1);
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Opts = { direction: 'in' | 'out' | 'both' };

/** kind 'app': the app view (opens 300 ms, closes 260 ms). kind 'home': the home view behind it (280 ms). */
export function zoom(_node: Element, p: { kind: 'app' | 'home' }, o: Opts): TransitionConfig {
  if (reduced()) return { duration: 0 };
  const dirIn = o.direction !== 'out';
  if (p.kind === 'app') {
    const from = origin;
    if (!dirIn) setTimeout(() => (origin = '50% 50%'), 320);
    return {
      duration: dirIn ? 300 : 260,
      easing: EASE,
      css: (t) => `transform-origin:${from};transform:scale(${0.2 + 0.8 * t});opacity:${t};border-radius:${30 * (1 - t)}px;z-index:3`,
    };
  }
  return { duration: 280, easing: EASE, css: (t) => `transform:scale(${1.12 - 0.12 * t});opacity:${t};z-index:1` };
}

/** The dock slides down and fades while an app is open (240 ms). */
export function dockfx(_node: Element): TransitionConfig {
  if (reduced()) return { duration: 0 };
  return { duration: 240, easing: EASE, css: (t) => `opacity:${t};transform:translateY(${28 * (1 - t)}px)` };
}
