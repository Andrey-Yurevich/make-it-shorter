// Type-ahead for the pickers: the rules that turn keystrokes into a place in the list.
// They live apart from the component because they are the whole substance of the
// behaviour and the only part of it that can be checked without a browser.
//
// Nothing here filters. A letter moves the highlight and the list stays whole, which is
// the point: filtering is easy to write and wrong to use, because the language you are
// after disappears the moment you hit the wrong key, and with nothing left on screen
// there is nothing to correct — you have to work out what you typed before you can get
// back. Jumping costs a mistyped letter one more letter, not a restart.

export type Typing = { text: string; at: number };

export const TYPEAHEAD_RESET_MS = 1000;

// Keystrokes closer together than the reset are one word: "ge" finds German. After it
// the search starts over, so a letter pressed a minute later is a fresh jump and not the
// tail of something typed before.
export function addKeystroke(typing: Typing, char: string, now: number): Typing {
  const continues = now - typing.at < TYPEAHEAD_RESET_MS;
  return { text: continues ? typing.text + char : char, at: now };
}

// Which option the typing points at, or -1 when nothing matches — in which case the
// caller leaves the highlight alone rather than moving it somewhere arbitrary.
//
// One letter, or the same letter again, walks through the options beginning with it:
// "d" for Danish, "d" again for Dutch. That is what a native <select> does and what the
// hand expects. Anything longer is a prefix and is looked up from the top, so "du" is
// Dutch on the second key rather than a step past it.
//
// The search wraps round the end, and that is what makes a letter reliable: pressing
// "s" near the bottom of the list has to reach Spanish at the top, or the key looks
// broken.
export function matchIndex(labels: string[], text: string, base: number): number {
  if (labels.length === 0) {
    return -1;
  }

  const repeated = [...text].every((character) => character === text[0]);
  const needle = (repeated ? text[0] : text).toLowerCase();
  // Walking starts after the option the user is on; a prefix search starts at the top,
  // because it is looking for one particular option and not for the next of a kind.
  const from = repeated ? base + 1 : 0;

  for (let step = 0; step < labels.length; step++) {
    const index = (from + step + labels.length) % labels.length;
    if (labels[index].toLowerCase().startsWith(needle)) {
      return index;
    }
  }
  return -1;
}
