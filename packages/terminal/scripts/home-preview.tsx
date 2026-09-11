/**
 * The home screen, live, with nothing behind it:
 * pnpm --filter openmeet-terminal exec tsx watch scripts/home-preview.tsx
 *
 * `chat-demo`'s sibling for the first screen. No engine process, no devices, no network — the
 * real `HomeScreen` inside the real `FullScreen`, so what you move here is what ships. Under
 * `tsx watch` the process restarts on every save and the screen redraws in about a second,
 * which is as close to hot reload as a terminal app gets: Ink rebuilds the whole tree from a
 * fresh process, so there is no stale state to mislead you.
 *
 * `u` cycles what the updater has to say (nothing, downloaded, not ours to install, just
 * updated — remounting each time, so the tick plays again), `j` and `s` still do what they do,
 * `q` quits.
 */
import { render, useApp, useInput } from 'ink';
// Scripts sit outside tsconfig's `include`, so JSX here compiles through the classic runtime
// and React has to be in scope — `React.useState` keeps that import honestly used.
import React from 'react';
import { FullScreen } from '../src/app.js';
import { HomeScreen } from '../src/components/home-screen.js';
import { NAME_PALETTE } from '../src/lib/identity.js';
import { loadIdentity } from '../src/lib/settings.js';
import type { UpdateStatus } from '../src/lib/update.js';

interface Case {
  update: UpdateStatus | null;
  justUpdated: boolean;
}

const CASES: Case[] = [
  { update: null, justUpdated: false },
  { update: { version: '0.6.0', ready: true }, justUpdated: false },
  { update: { version: '0.6.0', ready: false, command: 'sudo npm install -g openmeet-terminal' }, justUpdated: false },
  { update: null, justUpdated: true },
];

/** Whoever is using this machine, or someone with a name of a useful length. */
const identity = loadIdentity() ?? { name: 'mvega', color: NAME_PALETTE[3].value };

function Preview() {
  const { exit } = useApp();
  const [index, setIndex] = React.useState(0);
  const current = CASES[index];

  useInput((input) => {
    if (input === 'u') setIndex((i) => (i + 1) % CASES.length);
    if (input === 'q') exit();
  });

  return (
    <FullScreen>
      <HomeScreen
        // Remount on every case so the `✓ updated` tick starts its four seconds again.
        key={index}
        identity={identity}
        version="0.5.2"
        update={current.update}
        justUpdated={current.justUpdated}
        onJoinRoom={() => {}}
        onSettings={() => {}}
        onRestartUpdate={() => {}}
        onQuit={() => exit()}
      />
    </FullScreen>
  );
}

render(<Preview />, { alternateScreen: true, incrementalRendering: false });
