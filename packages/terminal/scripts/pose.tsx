/**
 * The room, posed for a photograph: the real layout, filled with a call that is already under
 * way, and nothing moving.
 *
 *   pnpm --filter openmeet-terminal exec tsx scripts/pose.tsx
 *
 * It is `chat-demo.tsx`'s sibling — the same components, no server and no audio — but where the
 * demo animates so you can watch the chat scroll, this one holds still so you can screenshot it:
 * the conversation is already there, the meters sit at fixed levels, and the clock does not tick.
 * Every state worth showing is on screen at once — someone sharing a screen you are watching,
 * someone with their camera on, someone muted, a peer at 70% volume, and latencies far enough
 * apart to show all three colours.
 *
 * `tab` moves the focus: with the controls focused (how it starts) the keycaps are lit, which is
 * what you usually want in a picture; focus the composer instead and you can type a draft into
 * it, cursor and all, before pressing the shutter. `q` quits.
 *
 * Everything you would want to change for a different picture — the names, the colours, the
 * conversation, the levels — is in the constants at the top.
 */
import { Box, render, useApp, useInput, useWindowSize } from 'ink';
// biome-ignore lint/correctness/noUnusedImports: tsx compiles scripts/ with the classic JSX runtime, which needs React in scope
import React, { useState } from 'react';
import { ChatInput } from '../src/components/chat-input.js';
import { type ChatEntry, ChatLog } from '../src/components/chat-log.js';
import { Elapsed } from '../src/components/elapsed.js';
import { KeyHints } from '../src/components/key-hints.js';
import { ParticipantList } from '../src/components/participant-list.js';
import { SplitPanes } from '../src/components/split-panes.js';
import { MyActions, PeerActions } from '../src/components/status-bar.js';
import { Divider, Text } from '../src/components/text.js';
import type { RoomEvent } from '../src/engine/protocol.js';
import { NAME_PALETTE } from '../src/lib/identity.js';
import { getPlatformSupport } from '../src/lib/platform.js';
import { framedBorder, theme } from '../src/lib/theme.js';
import { APP_VERSION } from '../src/version.js';

const ROOM = 'standup';
/** How long the call has been going, which is what the header's clock shows. */
const CALL_MINUTES = 23;

const hex = (name: string) => NAME_PALETTE.find((c) => c.name === name)?.hex ?? theme.text;
const PEOPLE = {
  me: { id: '__me__', name: 'mvega', color: hex('yellow') },
  sofia: { id: 'sofia', name: 'sofia', color: hex('cyan') },
  diego: { id: 'diego', name: 'diego', color: hex('green') },
  amara: { id: 'amara', name: 'amara', color: hex('fuchsia') },
} as const;
type Who = keyof typeof PEOPLE;

/** A line of the conversation: a message, or one of the room's own events. */
type Line = { who: Who; text: string } | { event: Exclude<RoomEvent['type'], 'debug'>; who?: Who; text: string };

/**
 * The conversation. Written to look like the middle of a real call rather than a feature tour:
 * different lengths, a line long enough to wrap, and the events falling where they would fall.
 */
const SCRIPT: Line[] = [
  { event: 'join', who: 'me', text: 'joined the room' },
  { event: 'join', who: 'sofia', text: 'joined the room' },
  { who: 'sofia', text: 'morning — did the Windows build ever finish?' },
  { who: 'me', text: 'yeah, four minutes on the i7. rebuilding wrtc is most of it' },
  { event: 'join', who: 'diego', text: 'joined the room' },
  { who: 'diego', text: 'hey. audio is clean on my end this time, no robot voice' },
  { who: 'sofia', text: 'good. the dropouts are gone on my side too' },
  { who: 'sofia', text: 'let me put the trace up' },
  { event: 'screen', who: 'sofia', text: 'started screen sharing' },
  {
    who: 'me',
    text: 'that spike at the end is the camera opening — it holds the device for a moment after SIGTERM, which is why a preview right after a call used to fail',
  },
  { who: 'diego', text: 'so we wait for the exit instead of a timer?' },
  { who: 'me', text: 'already in — stopCapture only resolves once the grabber is really gone' },
  { event: 'join', who: 'amara', text: 'joined the room' },
  { who: 'amara', text: 'sorry, late. my mic was on the wrong device again' },
  { event: 'mute', who: 'amara', text: 'muted' },
  { who: 'sofia', text: 'no worries, we are still on the capture path' },
  { who: 'diego', text: 'looks good to me' },
  { who: 'me', text: 'one more pass on the docs and I will tag it' },
];

/** Fixed levels, so the meters are photogenic instead of whatever the last frame caught. */
const LEVELS = { __local__: 2600, sofia: 6400, diego: 1400, amara: 0 };
const LATENCIES = { sofia: 38, diego: 96, amara: 155 };

const startedAt = Date.now() - CALL_MINUTES * 60_000;
/** The lines land over the length of the call, so the timestamps are minutes apart. */
const ENTRIES: ChatEntry[] = SCRIPT.map((line, i) => {
  const who = line.who ? PEOPLE[line.who] : undefined;
  const named = 'event' in line ? line.who !== undefined : true;
  return {
    key: `${i}`,
    timestamp: startedAt + Math.round((i / SCRIPT.length) * (CALL_MINUTES - 1) * 60_000),
    kind: 'event' in line ? line.event : 'message',
    who: named ? who?.name : undefined,
    color: named ? who?.color : undefined,
    text: line.text,
  };
});

const platformName = getPlatformSupport().name;
const peers = [PEOPLE.sofia, PEOPLE.diego, PEOPLE.amara].map((p) => ({
  id: p.id,
  username: p.name,
  color: p.color,
  joinedAt: '',
}));

function Pose() {
  const { exit } = useApp();
  // Unfocused to start: the keycaps are lit, which is what a screenshot wants.
  const [inputFocused, setInputFocused] = useState(false);
  const { rows } = useWindowSize();

  useInput((input, key) => {
    if (key.tab) setInputFocused((f) => !f);
    else if (!inputFocused && (input === 'q' || key.escape)) exit();
  });

  return (
    <Box
      height={rows}
      borderStyle="round"
      borderBottom={false}
      backgroundColor={theme.bg}
      {...framedBorder}
      flexDirection="column"
      overflowY="hidden"
    >
      <Box paddingX={1} gap={1} justifyContent="space-between">
        <Box gap={1}>
          <Text bold color={theme.accent}>
            OpenMeet <Text dimColor>v{APP_VERSION}</Text> <Text dimColor>({platformName})</Text>
          </Text>
          <KeyHints hints={[{ key: 'q', label: 'leave', disabled: inputFocused }]} />
          <Text dimColor>|</Text>
          <Text>
            Room: <Text bold>{ROOM}</Text>
          </Text>
          <Text dimColor>|</Text>
          <Text>{peers.length + 1}p</Text>
          <Text dimColor>|</Text>
          <Elapsed since={startedAt} />
        </Box>
        <Box gap={1}>
          <Text color={theme.ok}>↑128k</Text>
          <Text color={theme.info}>↓384k</Text>
          <Text dimColor>|</Text>
          <Text>RTT:18ms</Text>
          <Text>Loss:0%</Text>
          <Text dimColor>|</Text>
          <Text color={theme.ok}>●</Text>
        </Box>
      </Box>
      <SplitPanes
        chat={
          <>
            <ChatLog entries={ENTRIES} arrowsScroll={inputFocused} />
            <ChatInput focused={inputFocused} onSend={() => {}} />
          </>
        }
        people={
          <>
            <ParticipantList
              myActions={
                <MyActions
                  isMuted={false}
                  isVideoMuted={false}
                  videoEnabled
                  webcamEnabled
                  isScreenSharing={false}
                  inputFocused={inputFocused}
                />
              }
              participants={peers}
              username={PEOPLE.me.name}
              color={PEOPLE.me.color}
              isMuted={false}
              isVideoMuted={false}
              videoEnabled
              isScreenSharing={false}
              remoteMuteStates={{ amara: true }}
              remoteVideoMuteStates={{ sofia: true, diego: false, amara: true }}
              remoteScreenShareStates={{ sofia: true }}
              // Upper case in the tags means the window is open here: sofia's screen and
              // diego's camera are being watched, which is the pair worth showing.
              peerVideoOpen={{ diego: true }}
              peerScreenOpen={{ sofia: true }}
              speakingStates={{ sofia: true }}
              audioLevels={LEVELS}
              peerVolumes={{ sofia: 1, diego: 1, amara: 0.7 }}
              selectedPeerIdx={0}
              connectionStats={{
                sendBitrateKbps: 128,
                recvBitrateKbps: 384,
                rttMs: 18,
                packetLossPercent: 0,
                peerRecvBitrateKbps: { sofia: 384, diego: 128, amara: 128 },
                peerLatencyMs: LATENCIES,
              }}
            />
            <Box flexGrow={1} />
            <Box paddingX={1} flexDirection="column">
              <Divider />
              <PeerActions hasPeers videoEnabled peerCam={null} peerScreen="close" inputFocused={inputFocused} />
            </Box>
          </>
        }
      />
    </Box>
  );
}

render(<Pose />, { alternateScreen: true, patchConsole: false });
