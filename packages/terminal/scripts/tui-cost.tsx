/**
 * What one frame of the room costs the TUI process.
 *
 * Renders the real room tree into a fake 120x34 terminal and drives it the way the engine
 * does — VU levels at 10 Hz — then the way it would be driven if the meters were gone and
 * only the speaking dot moved. Reports CPU per frame and bytes per frame.
 *
 *   pnpm exec tsx scripts/tui-cost.tsx [seconds-per-phase]
 */
import { EventEmitter } from 'node:events';
import { Box, render } from 'ink';
// biome-ignore lint/correctness/noUnusedImports: classic JSX runtime
import React, { useEffect, useState } from 'react';
import { ChatInput } from '../src/components/chat-input.js';
import { type ChatEntry, ChatLog } from '../src/components/chat-log.js';
import { Elapsed } from '../src/components/elapsed.js';
import { ParticipantList } from '../src/components/participant-list.js';
import { SplitPanes } from '../src/components/split-panes.js';
import { MyActions, PeerActions } from '../src/components/status-bar.js';
import { Divider, Text } from '../src/components/text.js';
import { framedBorder, theme } from '../src/lib/theme.js';

const SECONDS = Number(process.argv[2]) || 10;
const COLUMNS = 120;
const ROWS = 34;

class FakeStdout extends EventEmitter {
  columns = COLUMNS;
  rows = ROWS;
  isTTY = true;
  frames = 0;
  bytes = 0;
  write(s: string) {
    this.frames++;
    this.bytes += s.length;
    return true;
  }
}
class FakeStdin extends EventEmitter {
  isTTY = true;
  setRawMode() {}
  setEncoding() {}
  ref() {}
  unref() {}
  read() {
    return null;
  }
}

const stdout = new FakeStdout();
const peers = ['sofia', 'diego', 'amara'].map((n, i) => ({
  id: `p${i}`,
  username: n,
  joinedAt: Date.now(),
  color: theme.accent,
})) as any[];

const entries: ChatEntry[] = Array.from({ length: 20 }, (_, i) => ({
  key: `m-${i}`,
  timestamp: Date.now() - (20 - i) * 1000,
  kind: 'message' as const,
  who: 'sofia',
  color: theme.accent,
  text: `linea de conversacion numero ${i} con algo de texto para que ocupe`,
}));

/** phase 1: levels move (today). phase 2: only the speaking dot moves. */
let renders = 0;
const Room = ({ mode }: { mode: 'levels' | 'dot' }) => {
  renders++;
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      n++;
      if (mode === 'levels') {
        // What a meter did: something visible changes on every tick.
        setLevels({ tick: n });
      } else if (n % 20 === 0) {
        // a dot flips about every two seconds, which is roughly how speech starts and stops
        setSpeaking((s) => ({ ...s, p0: !s.p0 }));
      }
    }, 100);
    return () => clearInterval(t);
  }, [mode]);

  return (
    <Box
      height={ROWS}
      borderStyle="round"
      borderBottom={false}
      backgroundColor={theme.bg}
      {...framedBorder}
      flexDirection="column"
      overflowY="hidden"
    >
      <Box flexDirection="column" flexGrow={1}>
        <Box paddingX={1}>
          <Text bold color={theme.accent}>
            OpenMeet
          </Text>
          <Text> bench · 4 · {levels.tick ?? 0} · </Text>
          <Elapsed since={Date.now() - 60_000} />
        </Box>
        <SplitPanes
          chat={
            <>
              <ChatLog entries={entries} arrowsScroll active />
              <ChatInput focused={false} active onSend={() => {}} />
            </>
          }
          people={
            <>
              <ParticipantList
                myActions={
                  <MyActions isMuted={false} isVideoMuted videoEnabled webcamEnabled isScreenSharing={false} />
                }
                participants={peers}
                username="mvega"
                color={theme.accent}
                isMuted={false}
                isVideoMuted
                videoEnabled
                isScreenSharing={false}
                remoteMuteStates={{}}
                remoteVideoMuteStates={{}}
                remoteScreenShareStates={{}}
                peerVideoOpen={{}}
                peerScreenOpen={{}}
                speakingStates={speaking}
                peerVolumes={{}}
                selectedPeerIdx={0}
                connectionStats={null}
              />
              <Box flexGrow={1} />
              <Box paddingX={1} flexDirection="column">
                <Divider />
                <PeerActions hasPeers videoEnabled peerCam={null} peerScreen={null} />
              </Box>
            </>
          }
        />
      </Box>
    </Box>
  );
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function phase(name: string, mode: 'levels' | 'dot') {
  const app = render(<Room mode={mode} />, {
    stdout: stdout as any,
    stdin: new FakeStdin() as any,
    patchConsole: false,
  });
  await sleep(1000);
  const r0 = renders;
  const f0 = stdout.frames;
  const b0 = stdout.bytes;
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  await sleep(SECONDS * 1000);
  const cpu = process.cpuUsage(c0);
  const elapsed = performance.now() - t0;
  const frames = stdout.frames - f0;
  const rendered = renders - r0;
  const bytes = stdout.bytes - b0;
  const cpuMs = (cpu.user + cpu.system) / 1000;
  app.unmount();
  await sleep(200);
  console.log(
    `${name.padEnd(26)} ${(rendered / (elapsed / 1000)).toFixed(1).padStart(5)} renders/s ${(frames / (elapsed / 1000)).toFixed(1).padStart(5)} writes/s  ` +
      `${((cpuMs / elapsed) * 100).toFixed(1).padStart(5)}% cpu  ` +
      `${(cpuMs / Math.max(1, rendered)).toFixed(2).padStart(6)} ms/render  ` +
      `${Math.round(bytes / Math.max(1, frames))} bytes/frame`,
  );
}

await phase('meters at 10 Hz (today)', 'levels');
await phase('speaking dot only', 'dot');
process.exit(0);
