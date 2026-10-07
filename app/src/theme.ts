// Toto is a remote for a headless box that runs terminals, so the app is drawn like one: a single
// monospace face on an unlit-CRT background, amber for anything that is you or is waiting on you.

export const color = {
  tube: '#11140F', // the screen
  bezel: '#1D2119', // raised surfaces: inputs, keys, the status line
  rule: '#30362A', // hairlines
  phosphor: '#ECE6D2', // text
  ghost: '#959B85', // secondary text
  hint: '#7C8270', // placeholder text in an empty field: readable, but plainly not a value
  amber: '#FFB000', // you: the prompt, the primary action, an agent waiting on you
  signal: '#8BD45F', // an agent at work, a healthy link
  raspberry: '#F25C82', // errors, deny, delete
  sky: '#7FC8E8', // links, and the places a diff points to
};

export const font = {
  regular: 'IBMPlexMono_400Regular',
  italic: 'IBMPlexMono_400Regular_Italic',
  medium: 'IBMPlexMono_500Medium',
  bold: 'IBMPlexMono_700Bold',
};

// A 1.25 scale around the body size.
export const size = { small: 12, body: 15, large: 19, display: 46 };

export const gutter = 16;
/** Smallest comfortable touch target. */
export const tap = 44;
