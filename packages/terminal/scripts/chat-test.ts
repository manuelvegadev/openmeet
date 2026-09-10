/**
 * Device-free check of the chat panel — what it shows and how it scrolls:
 * pnpm --filter openmeet-terminal exec tsx scripts/chat-test.ts
 *
 * Renders the real `ChatLog` through Ink into a fake terminal (60 columns, 8 rows) and reads
 * the frames back, then drives it with the same bytes a terminal sends for the keys. What is
 * pinned: the newest entry sits on the last row; a message longer than the width wraps and
 * costs a row; ↑ and Page Up reveal older entries with a count of what is hidden below; an
 * entry arriving while you read older ones does not move the view; ↓ / Page Down return to
 * the tail and following resumes; with the input unfocused the arrows do nothing and the
 * page keys still work.
 */
import { EventEmitter } from 'node:events';
import { Box, render } from 'ink';
import React from 'react';
import stripAnsi from 'strip-ansi';
import { type ChatEntry, ChatLog, mergeChat } from '../src/components/chat-log.js';
import { check, finish, sleep } from './harness.js';

const COLUMNS = 60;
const ROWS = 8;

class FakeStdout extends EventEmitter {
  columns = COLUMNS;
  rows = ROWS;
  isTTY = true;
  frames: string[] = [];
  write(s: string) {
    this.frames.push(s);
    return true;
  }
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  private pending: string | null = null;
  setRawMode() {}
  setEncoding() {}
  ref() {}
  unref() {}
  resume() {}
  pause() {}
  read() {
    const p = this.pending;
    this.pending = null;
    return p;
  }
  press(sequence: string) {
    this.pending = sequence;
    this.emit('readable');
  }
}

const KEY = { up: '\x1b[A', down: '\x1b[B', pageUp: '\x1b[5~', pageDown: '\x1b[6~' };

const stdout = new FakeStdout();
const stdin = new FakeStdin();

/** The last frame Ink wrote, as trimmed rows. */
const rows = () =>
  stripAnsi(stdout.frames.at(-1) ?? '')
    .split('\n')
    .map((r) => r.trimEnd());
const lastRow = () =>
  (
    rows()
      .filter((r) => r.length > 0)
      .at(-1) ?? ''
  ).trim();
/** The row right above the first row containing `needle`. */
const rowAbove = (needle: string) => {
  const all = rows();
  const i = all.findIndex((r) => r.includes(needle));
  return i > 0 ? all[i - 1] : '';
};
const has = (needle: string) => rows().some((r) => r.includes(needle));

let n = 0;
const message = (who: string, text: string): ChatEntry => ({
  key: `m-${++n}`,
  timestamp: 1_700_000_000_000 + n * 1000,
  kind: 'message',
  who,
  text,
});

const initial: ChatEntry[] = [];
for (let i = 1; i <= 12; i++) {
  initial.push(i === 6 ? message('🦉', `msg ${i} ${'x'.repeat(40)} tail-of-6`) : message('🦉', `msg ${i}`));
}

/** The panel in a box the size of the fake terminal. `show` swaps its props without remounting. */
const panel = (entries: ChatEntry[], focused = true) =>
  React.createElement(
    Box,
    { width: COLUMNS, height: ROWS, flexDirection: 'column' },
    React.createElement(ChatLog, { entries, arrowsScroll: focused }),
  );
const app = render(panel(initial), { stdout: stdout as any, stdin: stdin as any, debug: true, patchConsole: false });
const show = (entries: ChatEntry[], focused = true) => app.rerender(panel(entries, focused));

const settle = () => sleep(40);
const press = async (sequence: string, times = 1) => {
  for (let i = 0; i < times; i++) {
    stdin.press(sequence);
    await settle();
  }
};

(async () => {
  await settle();
  check('the panel is exactly as tall as its box', rows().length, ROWS);
  check('at rest the newest entry is on the last row', lastRow().includes('msg 12'), true);
  check('the oldest entries are clipped above', has('msg 1 ') || has('msg 2'), false);
  check('a long message wraps rather than being cut', has('tail-of-6'), true);
  check(
    '...and its head is on a row above its tail',
    rows().findIndex((r) => r.includes('msg 6')) < rows().findIndex((r) => r.includes('tail-of-6')),
    true,
  );

  await press(KEY.up, 3);
  check('↑ ×3 puts the hidden count on the last row', lastRow(), '↓ 3 more entries below');
  check('...and msg 9 just above it', rowAbove('more entries').includes('msg 9'), true);
  check('...with no row left blank above the oldest shown', rows()[0].length > 0, true);

  show([...initial, message('🥝', 'msg 13')]);
  await settle();
  check('a new entry while scrolled does not move the view', rowAbove('more entries').includes('msg 9'), true);
  check('...but is counted', lastRow(), '↓ 4 more entries below');

  await press(KEY.pageDown);
  check('Page Down returns to the tail', lastRow().includes('msg 13'), true);
  check('...and the count is gone', has('more entr'), false);

  await press(KEY.pageUp);
  check('Page Up moves ten entries', rowAbove('more entries').includes('msg 3'), true);
  check('...counting the rest', lastRow(), '↓ 10 more entries below');

  await press(KEY.down, 10);
  check('↓ back to the last entry resumes following', lastRow().includes('msg 13'), true);

  show([...initial, message('🥝', 'msg 13'), message('🥝', 'msg 14')]);
  await settle();
  check('...so the next entry shows up on the last row', lastRow().includes('msg 14'), true);

  const all = [...initial, message('🥝', 'msg 13'), message('🥝', 'msg 14')];
  show(all, false);
  await settle();
  await press(KEY.up, 2);
  check('with the input unfocused ↑ is left to the participant list', lastRow().includes('msg 14'), true);
  await press(KEY.pageUp);
  check('...while Page Up still scrolls', lastRow(), '↓ 10 more entries below');

  // The merge that feeds the panel: time order, debug lines left out, stable within a millisecond.
  const merged = mergeChat(
    [
      { type: 'chat-message', id: 'a', roomId: 'r', username: '🦉', content: 'first', timestamp: 100 },
      { type: 'chat-message', id: 'b', roomId: 'r', username: '🦉', content: 'third', timestamp: 300 },
    ],
    [
      { id: 1, timestamp: 200, message: 'second', type: 'join', who: '🐼' },
      { id: 2, timestamp: 250, message: 'never', type: 'debug' },
      { id: 3, timestamp: 300, message: 'fourth, same ms as third', type: 'info' },
    ],
  );
  check(
    'mergeChat interleaves by time and drops debug lines',
    merged.map((e) => e.text).join(' | '),
    'first | second | third | fourth, same ms as third',
  );
  check('...carrying who the event is about', merged[1].who, '🐼');

  // Every line has the same shape: time, icon, [who], what — one space between each, no padding.
  show([
    message('🦉', 'hello'),
    { key: 'j', timestamp: 1_700_000_100_000, kind: 'join', who: '🐼', text: 'joined' },
    { key: 'n', timestamp: 1_700_000_200_000, kind: 'info', text: 'Debug mode enabled' },
  ]);
  await settle();
  const shape = rows()
    .filter((r) => r.length > 0)
    .slice(-3)
    .map((r) => r.replace(/^ \[\d\d:\d\d\] /, ''));
  check('a message line is icon, [who], what', shape[0], '› [🦉] hello');
  check('an event line likewise', shape[1], '+ [🐼] joined');
  check('a notice about nobody goes from the icon to the text', shape[2], '· Debug mode enabled');

  app.unmount();
  finish();
})();
