/**
 * Device-free check of the child-process gate:
 * pnpm --filter openmeet-terminal exec tsx scripts/children-test.ts
 *
 * The bug this exists for cost a machine: a camera that would not open was reopened several
 * times a second, each turn spawning ffmpeg, until the box ran out of memory. A counter in
 * that one loop is not enough — the gate has to hold whatever the caller does, so this drives
 * it the way a runaway loop would and asserts that it stops, that it stops *per kind*, that a
 * deliberate restart is forgiven, and that nothing is left running.
 */
import {
  census,
  forgiveChildKind,
  killAllChildren,
  killChild,
  liveChildCount,
  setChildLogger,
  spawnChild,
} from '../src/lib/children.js';
import { check, finish, sleep } from './harness.js';

/** A child that stays up until killed, with no dependency on ffmpeg being installed. */
const sleeper = () =>
  spawnChild('preview', process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });

// Refusals are counted, because the engine's logger writes synchronously on the audio loop:
// a loop that is refused thousands of times must not say so thousands of times.
let logged = 0;
setChildLogger(() => {
  logged++;
});

// A loop that spawns as fast as it can, exactly like the camera retry did.
let spawned = 0;
let refused = 0;
for (let i = 0; i < 50; i++) {
  const proc = sleeper();
  if (proc) spawned++;
  else refused++;
}
check('a runaway loop is cut off', spawned < 10, true);
check(`...and says so once, not once per attempt (${logged} lines for ${50 - spawned} refusals)`, logged, 1);
check('...and the rest are refused, not spawned', refused, 50 - spawned);
check('...leaving only what it managed to start alive', liveChildCount(), spawned);
check(`...which the census can name (${census()})`, census().includes('preview'), true);

// The cooldown is per kind: one runaway must not take the others down with it.
const other = spawnChild('player', process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
check('another kind still starts while one is on cooldown', other !== null, true);
if (other) await killChild(other, 300);

// A person restarting it on purpose is forgiven, once the earlier ones are gone.
killAllChildren();
await sleep(50);
forgiveChildKind('preview');
const afterForgiving = sleeper();
check('a deliberate restart is allowed again', afterForgiving !== null, true);
if (afterForgiving) await killChild(afterForgiving, 300);

// The ceiling holds even when the burst never trips, because the budget is forgiven each time.
const held: (ReturnType<typeof sleeper> | null)[] = [];
for (let i = 0; i < 20; i++) {
  forgiveChildKind('preview');
  held.push(sleeper());
}
check('the ceiling stops it too, however slowly it is asked', liveChildCount(), 12);
check('...refusing the rest', held.filter((p) => p === null).length, 8);

killAllChildren();
await sleep(50);
check('killing them all leaves nothing tracked', liveChildCount(), 0);
for (const proc of held) proc?.kill('SIGKILL');

finish();
