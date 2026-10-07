// `toto`: the tool on the device itself. With no arguments it is a live screen, which is what
// the device shows on its own display in place of a login prompt. With one, it does a single
// thing and exits:
//
//   toto status           what this Toto is doing
//   toto pair [minutes]   open pairing mode, so a new phone can set it up over Bluetooth
//   toto pair off         close it again
//   toto name <new name>  rename this Toto
//   toto wifi             choose a Wi-Fi network
//
// It talks to the running server over a local socket, so it needs to be run as root.
import { execFileSync, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { FRAMES, type Mood } from './moods.ts';

const SOCKET = process.env.TOTO_CTL ?? '/run/toto/ctl.sock';
const PRIV = '/opt/toto/bin/toto-priv';

type Status = {
  name: string; claimed: boolean; pairingSeconds: number; advertising: boolean; bluetooth: boolean;
  wifi: string | null; ip: string | null; relay: string | null;
  phones: number; projects: number; agents: number; running: number; waiting: number;
};

/** Sends the server one request and resolves to its status afterwards, or undefined if it is not there. */
const ask = (request: object) =>
  new Promise<Status | undefined>((resolve) => {
    const socket = createConnection(SOCKET);
    const give = (status?: Status) => {
      socket.destroy();
      resolve(status);
    };
    socket.on('error', () => give());
    socket.setTimeout(4_000, () => give());
    createInterface({ input: socket })
      .on('error', () => give()) // readline repeats the socket's errors, and an unheard one is fatal
      .on('line', (line) => {
        try {
          give(JSON.parse(line));
        } catch {
          give();
        }
      });
    socket.write(JSON.stringify(request) + '\n');
  });

// The app's colours, for a terminal.
const paint = (rgb: string) => (text: string) => `\x1b[38;2;${rgb}m${text}\x1b[39m`;
const amber = paint('255;176;0');
const ghost = paint('149;155;133');
const raspberry = paint('242;92;130');
const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;

function moodOf(status: Status | undefined): Mood {
  if (!status) return 'offline';
  if (!status.claimed || status.pairingSeconds > 0) return 'looking';
  if (!status.ip) return 'offline';
  if (status.waiting > 0) return 'waiting';
  if (status.running > 0) return 'working';
  return 'awake';
}

/** The face for a mood at a moment in time, as two lines of text. */
function face(mood: Mood, at: number): [string, string] {
  const frames = FRAMES[mood];
  const total = frames.reduce((sum, f) => sum + f.ms, 0);
  let t = total ? at % total : 0;
  const frame = frames.find((f) => (t -= f.ms) < 0) ?? frames[0];
  const ink = mood === 'waiting' ? amber : mood === 'failed' ? raspberry : mood === 'offline' ? ghost : bold;
  const nose = mood === 'awake' || mood === 'working' || mood === 'resting' ? amber(frame.nose) : ink(frame.nose);
  return [ink((frame.face + frame.extra).padEnd(9)), `  ${nose}      `];
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** What to say about a status, a line at a time. */
function describe(status: Status | undefined): string[] {
  if (!status) return [raspberry('The Toto service is not running.'), ghost('Press r to start it. If this was not run as root, try: sudo toto')];
  const where = status.ip ? `on ${status.wifi ?? 'the network'} at ${status.ip}` : 'not on a network';
  const lines = [ghost(where), ''];
  if (!status.ip) lines.push('Press w to join a Wi-Fi network.');
  if (status.pairingSeconds > 0)
    lines.push(amber(`Pairing mode for another ${clock(status.pairingSeconds)}.`), 'On your phone, open the Toto app and choose "Find a new Toto nearby".');
  else if (!status.claimed) lines.push(amber('Not set up yet.'), 'On your phone, open the Toto app and choose "Find a new Toto nearby".');
  else lines.push(`This Toto has an owner. ${plural(status.phones, 'phone')} connected right now.`);
  if (!status.bluetooth) lines.push(ghost('This machine has no Bluetooth, so it has to be added by address and token.'));
  if (status.claimed) {
    lines.push(`${plural(status.agents, 'agent')} in ${plural(status.projects, 'project')}: ${status.running} working, ${status.waiting > 0 ? amber(`${status.waiting} waiting on you`) : '0 waiting on you'}.`);
    lines.push(ghost(status.relay ? `Reachable away from home through ${status.relay}` : 'No relay set, so it can only be reached on this network.'));
  }
  return lines;
}

function wifiList() {
  const out = execFileSync(PRIV, ['wifi-list'], { encoding: 'utf8' });
  const seen = new Map<string, { ssid: string; signal: number; secure: boolean; current: boolean }>();
  for (const line of out.split('\n')) {
    const [inUse, signal, security, ...name] = line.split(/(?<!\\):/);
    const ssid = name.join(':').replace(/\\(.)/g, '$1');
    if (ssid && !seen.has(ssid)) seen.set(ssid, { ssid, signal: Number(signal) || 0, secure: !!security && security !== '--', current: inUse === '*' });
  }
  return [...seen.values()].sort((a, b) => b.signal - a.signal).slice(0, 12);
}

/** Asks one question on the terminal. `hidden` keeps the answer off the screen. */
function question(prompt: string, hidden = false) {
  return new Promise<string>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) (rl as any)._writeToOutput = (text: string) => process.stdout.write(text.includes(prompt) ? text : '');
    rl.question(prompt, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function wifi() {
  console.log('Looking for networks…');
  const networks = wifiList();
  if (!networks.length) return console.log('No networks found.');
  networks.forEach((n, i) => console.log(`  ${String(i + 1).padStart(2)}  ${n.ssid.padEnd(32)} ${ghost(`${n.signal}%  ${n.secure ? 'locked' : 'open'}`)}${n.current ? amber('  in use') : ''}`));
  const choice = networks[Number(await question('Join which one? (number, or Enter to cancel) ')) - 1];
  if (!choice) return;
  const password = choice.secure ? await question(`Password for ${choice.ssid}: `, true) : '';
  console.log(`Joining ${choice.ssid}. This can take up to a minute.`);
  const joined = spawnSync(PRIV, ['wifi-join', choice.ssid], { input: password + '\n', encoding: 'utf8' });
  console.log(joined.status === 0 ? `Joined ${choice.ssid}.` : raspberry((joined.stderr || 'Could not join that network.').trim()));
}

/** The live screen. */
async function screen() {
  const { stdin, stdout } = process;
  let status = await ask({ cmd: 'status' });
  let busy = false; // a prompt has the terminal; the screen waits
  const started = Date.now();
  const enter = () => {
    stdout.write('\x1b[?1049h\x1b[?25l');
    stdin.setRawMode(true);
    stdin.resume();
  };
  const leave = () => {
    stdin.setRawMode(false);
    stdout.write('\x1b[?25h\x1b[?1049l');
  };
  const draw = () => {
    if (busy) return;
    const [top, bottom] = face(moodOf(status), Date.now() - started);
    const body = describe(status);
    const out = ['', '', `   ${top}  ${bold(status?.name ?? 'toto')}`, `   ${bottom}  ${body[0] ?? ''}`, ...body.slice(1).map((l) => `   ${l}`), '', ''];
    const keys = [['p', status?.pairingSeconds ? 'stop pairing' : 'pairing mode'], ['w', 'Wi-Fi'], ['n', 'rename'], ['r', 'restart'], ['s', 'shell'], ['q', 'quit']];
    out.push('   ' + keys.map(([k, what]) => `${amber(k)} ${what}`).join('   '));
    // Home, then each line cleared to its end as it is drawn, then everything below: no flicker.
    stdout.write('\x1b[H' + out.map((l) => l + '\x1b[K').join('\n') + '\x1b[J');
  };
  /** Hands the terminal to something that needs ordinary typing, then takes it back. */
  const aside = async (work: () => Promise<void> | void) => {
    busy = true;
    leave();
    try {
      await work();
    } catch (err) {
      console.log(raspberry(String((err as Error).message ?? err)));
    }
    await question(ghost('Press Enter to go back.'));
    enter();
    busy = false;
    status = await ask({ cmd: 'status' });
  };

  enter();
  const tick = setInterval(draw, 120);
  const poll = setInterval(async () => !busy && (status = await ask({ cmd: 'status' })), 2_000);
  const quit = () => {
    clearInterval(tick);
    clearInterval(poll);
    leave();
    process.exit(0);
  };
  process.on('SIGTERM', quit);
  stdin.on('data', async (key: Buffer) => {
    if (busy) return;
    const k = key.toString().toLowerCase();
    if (k === 'q' || k === '\x03') return quit();
    if (k === 'p') status = await ask(status?.pairingSeconds ? { cmd: 'stop-pairing' } : { cmd: 'pair', minutes: 10 });
    if (k === 'w') await aside(wifi);
    if (k === 'n') await aside(async () => {
      const name = (await question('New name for this Toto: ')).trim();
      if (name) await ask({ cmd: 'rename', name });
    });
    if (k === 'r') await aside(() => {
      console.log('Restarting Toto…');
      spawnSync('systemctl', ['restart', 'toto'], { stdio: 'inherit' });
    });
    if (k === 's') await aside(() => {
      console.log(ghost('A root shell. Type exit to come back.'));
      spawnSync(process.env.SHELL || '/bin/bash', { stdio: 'inherit' });
    });
  });
}

const [command, ...rest] = process.argv.slice(2);
if (!command && process.stdin.isTTY) await screen();
else if (command === 'pair') {
  const status = await ask(rest[0] === 'off' ? { cmd: 'stop-pairing' } : { cmd: 'pair', minutes: Number(rest[0]) || 10 });
  console.log(!status ? raspberry('The Toto service is not running, or this was not run as root.') : status.pairingSeconds ? `Pairing mode for ${clock(status.pairingSeconds)}.` : 'Pairing mode is off.');
} else if (command === 'name' && rest.length) {
  const status = await ask({ cmd: 'rename', name: rest.join(' ') });
  console.log(status ? `This Toto is now called ${status.name}.` : raspberry('The Toto service is not running, or this was not run as root.'));
} else if (command === 'wifi') await wifi();
else if (!command || command === 'status') {
  const status = await ask({ cmd: 'status' });
  const [top, bottom] = face(moodOf(status), 0);
  const body = describe(status);
  console.log([`\n   ${top}  ${bold(status?.name ?? 'toto')}`, `   ${bottom}  ${body[0] ?? ''}`, ...body.slice(1).map((l) => `   ${l}`), ''].join('\n'));
} else {
  console.log('usage: toto [status | pair [minutes|off] | name <new name> | wifi]');
  process.exit(2);
}
