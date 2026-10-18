// Playback clock for the cinematic timeline.  `t` wraps around `duration`;
// `rot` is the planet-rotation clock, which runs whenever the scene is alive
// (playing, or in explore mode) and stops when the animation is paused.

export class Clock {
  t = 0;
  rot = 0;
  speed = 1;
  playing = true;
  duration = 60;
  private last = -1;

  tick(now: number, rotate: boolean): number {
    const dt = this.last < 0 ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.playing) {
      this.t += dt * this.speed;
      if (this.t >= this.duration) this.t %= this.duration;
    }
    if (rotate) this.rot += dt * Math.max(this.speed, 0.5);
    return dt;
  }

  /** Skip time without advancing (used while the hero is off screen). */
  hold(now: number): void { this.last = now; }

  seek(t: number): void {
    const d = this.duration;
    this.t = ((t % d) + d) % d;
  }
}
