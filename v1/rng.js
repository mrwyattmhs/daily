/**
 * Deterministic seeded randomness.
 *
 * Everything in this library takes an Rng instead of calling Math.random, so
 * the same date always produces the same puzzles — on every machine, in every
 * browser, on every reload.
 */

/** Hash an arbitrary string into four 32-bit seeds (cyrb128). */
function hashSeed(str) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

export class Rng {
  constructor(seed) {
    this.seed = String(seed);
    const [a, b, c, d] = hashSeed(this.seed);
    this._a = a;
    this._b = b;
    this._c = c;
    this._d = d;
  }

  /** Float in [0, 1). sfc32 — fast, small state, passes PractRand. */
  next() {
    this._a >>>= 0;
    this._b >>>= 0;
    this._c >>>= 0;
    this._d >>>= 0;
    let t = (this._a + this._b) | 0;
    this._a = this._b ^ (this._b >>> 9);
    this._b = (this._c + (this._c << 3)) | 0;
    this._c = (this._c << 21) | (this._c >>> 11);
    this._d = (this._d + 1) | 0;
    t = (t + this._d) | 0;
    this._c = (this._c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n) {
    return Math.floor(this.next() * n);
  }

  /** Integer in [min, max], inclusive both ends. */
  range(min, max) {
    return min + this.int(max - min + 1);
  }

  /** Random element of an array. */
  pick(arr) {
    return arr[this.int(arr.length)];
  }

  /** Fisher-Yates, in place. Returns the same array. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** True with probability p. */
  chance(p) {
    return this.next() < p;
  }

  /**
   * Weighted pick. `weights[i]` is the relative weight of `items[i]`.
   * Weights need not sum to 1.
   */
  weighted(items, weights) {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /**
   * Derive an independent stream from this one. Lets each generator have its
   * own RNG without one generator's number of calls shifting another's output.
   */
  fork(label) {
    return new Rng(`${this.seed}::${label}`);
  }
}

/** Today's date as YYYY-MM-DD in a specific IANA timezone. */
export function dateKey(date = new Date(), timeZone = 'America/New_York') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** The canonical way to seed a day: `rngForDate('2026-08-27')`. */
export function rngForDate(dk) {
  return new Rng(`puzzle-day:${dk}`);
}
