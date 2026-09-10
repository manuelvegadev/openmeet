/**
 * Device-free check of the room's frame — what the last rows are:
 * pnpm --filter openmeet-terminal exec tsx scripts/room-frame-test.tsx
 *
 * Renders the real `SplitPanes`, `ChatInput`, `ParticipantList` and key rows into a fake
 * terminal inside a copy of `app.tsx`'s `FullScreen`, and reads the frame back.
 *
 * The bug this exists for: `SplitPanes` drew a rule under the panes to separate them from the
 * bottom bar, and when the bar was retired the rule stayed — stacked directly on the frame's
 * bottom border, enclosing nothing, which reads as an empty bar. The room ends at its last row
 * of content now; a caller that passes a `footer` still gets the rule, because there the rule
 * separates something.
 */
import { EventEmitter } from 'node:events';
import { Box, render } from 'ink';
import React from 'react';
import stripAnsi from 'strip-ansi';
import { ChatInput } from '../src/components/chat-input.js';
import { ChatLog } from '../src/components/chat-log.js';
import { ParticipantList } from '../src/components/participant-list.js';
import { SplitPanes } from '../src/components/split-panes.js';
import { MyActions, PeerActions } from '../src/components/status-bar.js';
import { Divider, Text } from '../src/components/text.js';
import { framedBorder, theme } from '../src/lib/theme.js';
import { check, finish, sleep } from './harness.js';

const COLUMNS = 110;
const ROWS = 12;

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
  setRawMode() {}
  setEncoding() {}
  ref() {}
  unref() {}
  read() {
    return null;
  }
}

const stdout = new FakeStdout();

/** `FullScreen` from app.tsx: the terminal-sized frame the room is drawn inside. */
const Frame = ({ children, closeBottom = true }: { children: React.ReactNode; closeBottom?: boolean }) => (
  <Box
    height={ROWS}
    borderStyle="round"
    borderBottom={closeBottom}
    backgroundColor={theme.bg}
    {...framedBorder}
    flexDirection="column"
    overflowY="hidden"
  >
    {children}
  </Box>
);

const peer = { id: 'p0', username: 'peer', joinedAt: Date.now(), color: theme.accent } as any;

/** The room, with the engine's state stubbed — only the shape of the frame is under test. */
const Room = ({ footer }: { footer?: React.ReactNode }) => (
  <Box flexDirection="column" flexGrow={1}>
    <Box paddingX={1}>
      <Text bold color={theme.accent}>
        OpenMeet
      </Text>
    </Box>
    <SplitPanes
      footer={footer}
      chat={
        <>
          <ChatLog entries={[]} arrowsScroll active />
          <ChatInput focused active onSend={() => {}} />
        </>
      }
      people={
        <>
          <ParticipantList
            myActions={<MyActions isMuted={false} isVideoMuted videoEnabled webcamEnabled isScreenSharing={false} />}
            participants={[peer]}
            username="me"
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
            speakingStates={{}}
            audioLevels={{}}
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
);

const app = render(
  <Frame closeBottom={false}>
    <Room />
  </Frame>,
  { stdout: stdout as any, stdin: new FakeStdin() as any, debug: true, patchConsole: false },
);

const rows = () =>
  stripAnsi(stdout.frames.at(-1) ?? '')
    .split('\n')
    .map((r) => r.trimEnd());

await sleep(80);

let frame = rows();
check(`the frame is exactly as tall as the terminal (${frame.length} rows)`, frame.length, ROWS);
const bottom = frame.at(-1) ?? '';
check("closed by a bottom edge with the frame's own corners", /^╰.*╯$/.test(bottom), true);
check("...carrying the divider's junction", /┴/.test(bottom), true);

const lastContent = frame.at(-2) ?? '';
check(
  `the row above it is content, not a second line (${lastContent.trim().slice(0, 28)}…)`,
  /Type message/.test(lastContent),
  true,
);
check('...so nothing encloses an empty strip', /[├┴]/.test(lastContent), false);
check('...and it is not blank', lastContent.replace(/[│\s]/g, '') === '', false);

// The divider still meets the header's rule where the two panes meet.
const headerRule = frame.find((r) => r.includes('┬')) ?? '';
const bodyRow = frame.find((r) => /Type message/.test(r)) ?? '';
check('the ┬ sits on the divider', headerRule.indexOf('┬'), bodyRow.indexOf('│', 1));
check('...and the ┴ under it', bottom.indexOf('┴'), bodyRow.indexOf('│', 1));

// A caller with something below the panes still gets the rule that separates it.
app.rerender(
  <Frame>
    <Room
      footer={
        <Box paddingX={1}>
          <Text>demo keys</Text>
        </Box>
      }
    />
  </Frame>,
);
await sleep(80);
frame = rows();
check('a footer brings the rule back', /┴/.test(frame.at(-3) ?? ''), true);
check('...with the footer under it', /demo keys/.test(frame.at(-2) ?? ''), true);

app.unmount();
finish();
