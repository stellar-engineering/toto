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
