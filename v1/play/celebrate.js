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

const DURATION = 4200;
const SHELLS = 7;
const PARTICLES_PER_SHELL = 46;
// Hard ceiling so a mid-range phone doesn't stutter.
const MAX_PARTICLES = 420;

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

  /** @type {{x:number,y:number,vx:number,vy:number,life:number,max:number,color:string,size:number}[]} */
  let particles = [];
  const shells = [];

  // Spread launches across the run and across the screen, so it reads as
  // fireworks rather than one burst.
  for (let i = 0; i < SHELLS; i++) {
    shells.push({
      at: (i / SHELLS) * (DURATION * 0.55) + Math.random() * 220,
      x: (0.12 + Math.random() * 0.76) * width(),
      y: (0.18 + Math.random() * 0.4) * height(),
      fired: false,
    });
  }

  function burst(x, y) {
    const color = colors[Math.floor(Math.random() * colors.length)];
    const speed = (5.5 + Math.random() * 3.5) * ratio;
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
        size: (1.6 + Math.random() * 1.9) * ratio,
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
        burst(shell.x, shell.y);
      }
    }

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
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    particles = particles.filter((p) => p.life < p.max);

    if (elapsed < DURATION || particles.length) {
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
