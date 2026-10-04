import { GameAudio } from './audio.js';
import { meter } from './chart.js';

export function clampTempo(value) { return Math.max(30, Math.min(240, Number(value) || 70)); }

// Web Audio owns click timing; short look-ahead schedules visuals to the same clock.
// Each transport owns its clicks, so stopping it leaves live piano audio alone.
export class SongTransport {
  constructor({ bars, signature = '4/4', bpm = 70, countIn = true, metronome = true, onBeat }) {
    this.total = bars.length * meter(signature).slots;
    this.signature = signature;
    this.bpm = clampTempo(bpm);
    this.metronome = metronome;
    this.onBeat = onBeat;
    this.cursor = countIn ? -4 : 0;
    this.pending = new Map();
    this.running = false;
    this.remaining = 0.03;
  }
  interval(cursor = this.cursor) {
    return 60 / this.bpm / (cursor < 0 ? 1 : meter(this.signature).subdivisions);
  }
  start() {
    GameAudio.init();
    this.running = true;
    this.next = GameAudio.getCtxTime() + this.remaining;
    this.timer = setInterval(() => this.schedule(), 20);
    this.schedule();
  }
  schedule() {
    if (!this.running) return;
    const now = GameAudio.getCtxTime();
    // A stalled foreground thread must not replay a burst of overdue clicks.
    if (this.next < now - 0.1) this.next = now + 0.02;
    while (this.next < now + 0.08) {
      const cursor = this.cursor;
      const index = cursor < 0 ? -1 : cursor % this.total;
      const { slots, subdivisions } = meter(this.signature);
      const event = cursor < 0
        ? { phase: 'countin', remaining: -cursor }
        : { phase: 'playing', index, bar: Math.floor(index / slots), beat: index % slots };
      const cancel = (this.metronome || cursor < 0)
        ? GameAudio.scheduleClick(this.next, cursor < 0 || index % slots === 0 || (subdivisions > 1 && index % slots % subdivisions === 0), true)
        : null;
      const time = this.next;
      const id = setTimeout(() => {
        this.pending.delete(cursor);
        if (this.running) this.onBeat(event);
      }, Math.max(0, (time - now) * 1000));
      this.pending.set(cursor, { id, cancel, time });
      this.next += this.interval(cursor);
      this.cursor++;
    }
  }
  pause() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    const first = this.pending.entries().next().value;
    if (first) { this.cursor = first[0]; this.next = first[1].time; }
    this.remaining = Math.max(0, this.next - GameAudio.getCtxTime());
    for (const item of this.pending.values()) { clearTimeout(item.id); item.cancel?.(); }
    this.pending.clear();
  }
  resume() { if (!this.running) this.start(); }
  setTempo(value) {
    const running = this.running;
    const old = this.bpm;
    this.pause();
    this.bpm = clampTempo(value);
    this.remaining *= old / this.bpm;
    if (running) this.resume();
  }
  setMetronome(enabled) {
    const running = this.running;
    this.pause();
    this.metronome = enabled;
    if (running) this.resume();
  }
  stop() { this.pause(); this.pending.clear(); }
}
