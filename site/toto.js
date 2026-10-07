// Toto's face, and the count of Totos online. The face is text, and it moves the way it does in
// the app and on the device: each character stays where it is and is swapped for another.
const NOSE = '•';
const FRAMES = {
  awake: [
    ['/o o\\', 1700], ['/- -\\', 140], ['/o o\\', 1000], ['/o O\\', 800], ['/o o\\', 500], ['/O o\\', 800],
    ['/o o\\', 1100], ['|o o\\', 170], ['/o o\\', 900], ['/. .\\', 600], ['/o o\\', 500], ['/- -\\', 140],
  ],
  resting: [['/- -\\', 1000], ['/- -\\ z', 700], ['/- -\\ zZ', 1000], ['/- -\\', 600]],
  looking: [['/. .\\', 450], ['/o o\\', 450], ['/. .\\', 450], ['/O O\\', 450]],
  offline: [['/. .\\', 0]],
};

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Draws a mood into an element and keeps it moving. Returns a function that changes the mood. */
function face(el, mood) {
  let frames = FRAMES[mood];
  let at = 0;
  let timer;
  const nose = el.dataset.nose !== 'none';
  const draw = () => {
    el.textContent = frames[at][0];
    if (nose) {
      const n = document.createElement('span');
      n.className = 'nose';
      // Two spaces in: under the middle of the five characters above it.
      n.textContent = '  ' + (mood === 'offline' || mood === 'looking' ? ' ' : NOSE);
      el.append(n);
    }
    el.className = `face ${mood}`;
    if (!still && frames.length > 1) timer = setTimeout(() => { at = (at + 1) % frames.length; draw(); }, frames[at][1]);
  };
  draw();
  return (next) => {
    if (next === mood) return;
    clearTimeout(timer);
    mood = next;
    frames = FRAMES[mood];
    at = 0;
    draw();
  };
}

for (const el of document.querySelectorAll('[data-face]:not([data-live])')) face(el, el.dataset.face);

// The documentation's list of sections: open down the side on a wide screen, a menu on a narrow
// one, and marking the section being read.
const contents = document.querySelector('.contents');
if (contents) {
  const wide = matchMedia('(min-width: 901px)');
  const fit = () => (contents.open = wide.matches);
  fit();
  wide.addEventListener('change', fit);
  const links = [...contents.querySelectorAll('a')];
  for (const a of links) a.addEventListener('click', () => wide.matches || (contents.open = false));
  const mark = (id) => links.forEach((a) => (a.getAttribute('href') === `#${id}` ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
  // A section counts as being read while its heading is in the top third of the screen.
  const seen = new IntersectionObserver((all) => all.forEach((e) => e.isIntersecting && mark(e.target.id)), { rootMargin: '0px 0px -66% 0px' });
  for (const h of document.querySelectorAll('.doc h2[id]')) seen.observe(h);
}

// The latest release: its version on the download link, and the image's size when it is there.
const get = document.querySelector('[data-release]');
if (get)
  fetch('/release')
    .then((r) => r.json())
    .then((r) => {
      if (!r.version) return;
      get.querySelector('[data-version]').textContent = `Toto ${r.version}`;
      const app = document.querySelector('[data-android]');
      if (r.android && app) app.href = r.android.url;
      if (!r.image) return;
      get.href = r.image.url;
      if (r.image.bytes) get.querySelector('[data-size]').textContent = `${Math.round(r.image.bytes / 1e6)} MB`;
    })
    .catch(() => {});

// The live count: how many Totos are connected to the relay this minute.
const count = document.querySelector('[data-count]');
if (count) {
  const setMood = face(document.querySelector('[data-live]'), 'looking');
  const say = (n) => {
    count.textContent = n === 0 ? 'No Totos are awake right now' : n === 1 ? '1 Toto is awake right now' : `${n} Totos are awake right now`;
    setMood(n === 0 ? 'resting' : 'awake');
  };
  const ask = () =>
    fetch('/stats')
      .then((r) => r.json())
      .then((s) => say(Number(s.live) || 0))
      .catch(() => {
        count.textContent = 'The relay did not answer';
        setMood('offline');
      });
  ask();
  setInterval(ask, 15000);
}

// The country behind the page: three ridges of hills drawn in characters, drifting past at
// different speeds under a few stars. The hills are sums of sines with random phases, so every
// visit gets its own and they never repeat or end.
(() => {
  const canvas = document.createElement('canvas');
  canvas.id = 'land';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const SIZE = 14, CW = SIZE * 0.6, CH = SIZE * 1.25;
  const rnd = () => Math.random() * Math.PI * 2;
  // Far to near: where the ridge sits (share of the screen's height), how tall, how fast, how lit.
  const ridges = [
    { at: 0.56, tall: 0.15, wide: 0.045, every: 6, colour: '#252a20', grass: 0.02 },
    { at: 0.7, tall: 0.12, wide: 0.07, every: 3, colour: '#2d3327', grass: 0.05 },
    { at: 0.86, tall: 0.09, wide: 0.1, every: 1, colour: '#3a4132', grass: 0.09 },
  ].map((r) => ({ ...r, p: [rnd(), rnd(), rnd()], x: Math.floor(Math.random() * 1e4) }));
  // A fixed pseudo-random number for a cell, so texture stays put on its hill as it moves.
  const hash = (a, b) => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  let cols = 0, rows = 0, tick = 0;

  const size = () => {
    const dpr = window.devicePixelRatio || 1;
    cols = Math.ceil(innerWidth / CW) + 1;
    rows = Math.ceil(innerHeight / CH) + 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${SIZE}px 'IBM Plex Mono', ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    draw();
  };

  const top = (r, wx) =>
    rows * (r.at - r.tall * (0.6 * Math.sin(wx * r.wide + r.p[0]) + 0.3 * Math.sin(wx * r.wide * 2.3 + r.p[1]) + 0.1 * Math.sin(wx * r.wide * 5.1 + r.p[2])));

  function draw() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (let c = 0; c < cols; c++) {
      // Nearest ridge first, so each only draws above what is already in front of it.
      let floor = rows;
      for (let i = ridges.length - 1; i >= 0; i--) {
        const r = ridges[i], wx = c + r.x;
        const height = top(r, wx), y = Math.floor(height), dy = top(r, wx + 1) - height;
        if (y >= floor) continue;
        ctx.fillStyle = r.colour;
        // Steep ground is a slope; gentler ground is a line high, middle or low in its cell.
        const part = height - y;
        ctx.fillText(dy < -0.45 ? '/' : dy > 0.45 ? '\\' : part < 0.34 ? '\u00af' : part < 0.67 ? '-' : '_', c * CW, y * CH);
        for (let row = y + 1; row < floor; row++) {
          const h = hash(wx, row + i * 57);
          // Grass, some of it moving in the wind.
          if (h < r.grass) ctx.fillText(h < r.grass / 3 ? (hash(wx + tick, row) < 0.5 ? ',' : "'") : h < r.grass / 1.5 ? '.' : '"', c * CW, row * CH);
        }
        floor = y;
      }
      for (let row = 0; row < floor - 1; row++) {
        const h = hash(c, row + 900);
        if (h > 0.012) continue;
        const lit = hash(c + Math.floor(tick / 6 + h * 4000), row);
        ctx.fillStyle = lit < 0.15 ? '#5a6150' : '#343a2d';
        ctx.fillText(lit < 0.15 ? '*' : h < 0.004 ? '+' : '.', c * CW, row * CH);
      }
    }
  }

  addEventListener('resize', size);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(size);
  if (still) return;
  setInterval(() => {
    if (document.hidden) return;
    tick++;
    for (const r of ridges) if (tick % r.every === 0) r.x++;
    draw();
  }, 220);
})();
