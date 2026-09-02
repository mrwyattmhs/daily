/**
 * Full-screen celebration for clearing every puzzle in a day.
 *
 * Two constraints shape this more than the visuals do:
 *
 * 1. `prefers-reduced-motion` gets a still stamp instead of animation. Flashing
 *    motion triggers nausea and migraine for some people, and this is a school
 *    page they can't opt out of.
 * 2. No full-screen flashes, and nothing pulsing near the 3 Hz range that can
 *    provoke photosensitive seizures. Particles fade individually; the backdrop
 *    never flashes. Rare, but the mitigation is free.
 */

const DURATION = 7000;
const SHELLS = 14;
const PARTICLES_PER_SHELL = 58;
// Hard ceiling so a mid-range phone doesn't stutter. Trails are counted here
// too, so this is the total live particle budget, not just burst fragments.
const MAX_PARTICLES = 900;
// Fraction of burst fragments that leave a short trail behind them.
const TRAIL_CHANCE = 0.5;

/** Pull the page's accent colours so this looks designed, not bolted on. */
function palette() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  // No dark ink here: near-black particles read as grey dust against the pale
  // paper rather than as fireworks.
  return [
    read('--ditto', '#55429b'),
    read('--ditto-pale', '#c9c2e6'),
    read('--flag', '#c8452a'),
    '#3f6b4a',
    '#c8922a',
  ];
}

function stamp(text) {
  const node = document.createElement('div');
  node.className = 'pz-celebrate-stamp';
  node.setAttribute('role', 'status');
  node.textContent = text;
  document.body.append(node);
  // Next frame so the fade-in transition actually runs.
  requestAnimationFrame(() => node.classList.add('pz-celebrate-in'));
  setTimeout(() => {
    node.classList.remove('pz-celebrate-in');
    setTimeout(() => node.remove(), 600);
  }, 2600);
}

/**
 * @param {object} [opts]
 * @param {string} [opts.message] Text shown over the animation.
 */
export function celebrate(opts = {}) {
  const message = opts.message ?? 'All five';

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    stamp(message);
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'pz-celebrate-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);

  const ctx = canvas.getContext('2d');
  // Cap the device ratio: a 3x phone display triples fill cost for no gain here.
  const ratio = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
  }
  resize();
  window.addEventListener('resize', resize);

  const colors = palette();
  const width = () => canvas.width;
  const height = () => canvas.height;

  /** @type {{x:number,y:number,vx:number,vy:number,life:number,max:number,color:string,size:number,trail:boolean}[]} */
  let particles = [];
  /** Rockets climbing toward their burst height. */
  let rockets = [];
  const shells = [];

  // Spread launches across the run and across the screen, so it reads as a
  // display rather than one big bang. Two or three overlap at the peak.
  for (let i = 0; i < SHELLS; i++) {
    shells.push({
      at: (i / SHELLS) * (DURATION * 0.72) + Math.random() * 260,
      x: (0.08 + Math.random() * 0.84) * width(),
      y: (0.12 + Math.random() * 0.42) * height(),
      fired: false,
    });
  }

  /** A rocket climbing from the bottom edge, trailing sparks as it goes. */
  function launch(shell) {
    const colour = colors[Math.floor(Math.random() * colors.length)];
    rockets.push({
      x: shell.x,
      y: height() * 1.02,
      targetY: shell.y,
      // Tuned so the climb reads as roughly half a second.
      vy: -(height() * 0.02) * (0.85 + Math.random() * 0.3),
      colour,
    });
  }

  function burst(x, y, forced) {
    const color = forced ?? colors[Math.floor(Math.random() * colors.length)];
    const speed = (6.5 + Math.random() * 4.5) * ratio;
    for (let i = 0; i < PARTICLES_PER_SHELL; i++) {
      if (particles.length >= MAX_PARTICLES) break;
      // Jittered angles: a perfectly even ring looks mechanical.
      const angle = (i / PARTICLES_PER_SHELL) * Math.PI * 2 + Math.random() * 0.22;
      const magnitude = speed * (0.55 + Math.random() * 0.45);
      const max = 900 + Math.random() * 700;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * magnitude,
        vy: Math.sin(angle) * magnitude,
        life: 0,
        max,
        color,
        size: (1.7 + Math.random() * 2.1) * ratio,
        trail: Math.random() < TRAIL_CHANCE,
      });
    }
  }

  const start = performance.now();
  let raf = 0;

  function frame(now) {
    const elapsed = now - start;
    const dt = 16;

    for (const shell of shells) {
      if (!shell.fired && elapsed >= shell.at) {
        shell.fired = true;
        launch(shell);
      }
    }

    // Climb, spark, then burst on arrival.
    for (const r of rockets) {
      r.y += r.vy;
      r.vy *= 0.988;
      if (particles.length < MAX_PARTICLES && Math.random() < 0.7) {
        particles.push({
          x: r.x + (Math.random() - 0.5) * 2 * ratio,
          y: r.y,
          vx: (Math.random() - 0.5) * 0.6 * ratio,
          vy: Math.random() * 0.5 * ratio,
          life: 0,
          max: 260,
          color: r.colour,
          size: 1.3 * ratio,
          trail: false,
        });
      }
    }
    for (const r of rockets) {
      if (r.y <= r.targetY) burst(r.x, r.y, r.colour);
    }
    rockets = rockets.filter((r) => r.y > r.targetY);

    // Clear fully each frame. Trailing via a translucent fill would leave a
    // haze over the page and dim the text underneath.
    ctx.clearRect(0, 0, width(), height());

    for (const p of particles) {
      p.life += dt;
      p.vy += 0.052 * ratio; // gravity
      p.vx *= 0.985; // drag
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;

      const t = p.life / p.max;
      if (t >= 1) continue;
      // Fade on a curve so particles die out gently instead of blinking off.
      const alpha = Math.max(0, 1 - t * t);

      if (p.trail) {
        // A short streak along the direction of travel reads as a spark rather
        // than a dot, and costs one extra stroke.
        ctx.globalAlpha = alpha * 0.4;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2);
        ctx.stroke();
      }

      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    particles = particles.filter((p) => p.life < p.max);

    if (elapsed < DURATION || particles.length || rockets.length) {
      raf = requestAnimationFrame(frame);
    } else {
      cleanup();
    }
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    canvas.remove();
  }

  raf = requestAnimationFrame(frame);
  stamp(message);

  // Never leave a canvas pinned over the page if something goes wrong.
  setTimeout(cleanup, DURATION + 2500);
}
