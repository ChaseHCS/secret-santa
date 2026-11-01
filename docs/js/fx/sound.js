// Tiny Web Audio synth: bell jingle, pop and tick. No audio files.
// The AudioContext is created lazily inside a user gesture (autoplay policy).
import { getSettings } from '../lib/settings.js';

let ctx = null;

function audio() {
  if (!getSettings().sound) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

function bell(ac, freq, at, dur = 1.1, vol = 0.18) {
  const out = ac.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(vol, at + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  out.connect(ac.destination);
  // Bell-ish partials.
  for (const [mult, amp] of [[1, 1], [2.0, 0.35], [3.01, 0.18], [4.2, 0.08]]) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * mult, at);
    g.gain.value = amp;
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.05);
  }
}

const NOTE = { C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, C6: 1046.5 };

/** The opening of "Jingle Bells" (public domain). */
export function playJingle() {
  const ac = audio();
  if (!ac) return;
  const q = 0.17;
  const seq = [
    ['E5', 1], ['E5', 1], ['E5', 2],
    ['E5', 1], ['E5', 1], ['E5', 2],
    ['E5', 1], ['G5', 1], ['C5', 1.5], ['D5', 0.5], ['E5', 3],
  ];
  let t = ac.currentTime + 0.05;
  for (const [n, beats] of seq) {
    bell(ac, NOTE[n], t, Math.max(0.5, beats * q * 2.2));
    t += beats * q;
  }
  bell(ac, NOTE.C6, t + 0.05, 1.4, 0.08);
}

export function playPop() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(520, t);
  o.frequency.exponentialRampToValueAtTime(120, t + 0.16);
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + 0.22);
}

export function playTick(pitch = 1) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(900 * pitch, t);
  g.gain.setValueAtTime(0.03, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + 0.05);
}
