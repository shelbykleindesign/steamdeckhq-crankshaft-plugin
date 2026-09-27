// Lap bookkeeping from a kart's continuous track distance. Because distance
// goes down when driving backwards, cutting back and forth over the line
// can't bank laps.

export class LapTracker {
  constructor(length, laps) {
    this.length = length;
    this.laps = laps;
    this.completed = 0;
    this.lapStart = 0;
    this.lapTimes = [];
    this.finishTime = null;
  }

  get finished() {
    return this.finishTime !== null;
  }

  /** 1-based lap currently being driven, capped at the final lap. */
  get lap() {
    return Math.min(this.laps, this.completed + 1);
  }

  get best() {
    return this.lapTimes.length ? Math.min(...this.lapTimes) : null;
  }

  /** Returns 'lap', 'finish' or null. */
  update(dist, raceTime) {
    if (this.finished) return null;
    const done = Math.floor(dist / this.length);
    if (done <= this.completed) return null;
    let result = null;
    while (this.completed < done && !this.finished) {
      this.completed++;
      this.lapTimes.push(raceTime - this.lapStart);
      this.lapStart = raceTime;
      if (this.completed >= this.laps) {
        this.finishTime = raceTime;
        result = 'finish';
      } else {
        result = 'lap';
      }
    }
    return result;
  }
}

/** Order racers: finishers by time, then everyone else by distance covered. */
export function standings(racers) {
  return [...racers].sort((a, b) => {
    const fa = a.finishTime ?? null;
    const fb = b.finishTime ?? null;
    if (fa !== null && fb !== null) return fa - fb;
    if (fa !== null) return -1;
    if (fb !== null) return 1;
    return b.dist - a.dist;
  });
}

export function formatTime(t) {
  if (t === null || t === undefined || !isFinite(t)) return '--:--.--';
  const neg = t < 0;
  t = Math.round(Math.abs(t) * 100) / 100;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${neg ? '-' : ''}${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

export function ordinal(n) {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}
