/**
 * The chat, live, with no server and no audio: the room's real layout in your own terminal,
 * four people with names of different lengths and colours, and a scripted conversation that
 * arrives one line at a time — short lines, lines that wrap, a word longer than the column,
 * joins, mutes, a screen share, a notice about nobody, someone leaving.
 *
 *   pnpm --filter openmeet-terminal exec tsx scripts/chat-demo.tsx [ms between lines]
 *
 * Keys while it runs: ↑/↓ scroll one entry, Page Up/Down ten (the same code path the room
 * uses — scroll up while lines keep arriving and the view holds, with the count below), space
 * pauses and resumes the feed, r restarts it, q or Escape quits. `scripts/chat-test.ts` pins
 * the same behaviour with assertions; this is for looking at it.
 */
import { Box, render, useApp, useInput, useWindowSize } from 'ink';
// biome-ignore lint/correctness/noUnusedImports: tsx compiles scripts/ with the classic JSX runtime, which needs React in scope
import React, { useEffect, useState } from 'react';
import { ChatInput } from '../src/components/chat-input.js';
import { type ChatEntry, ChatLog } from '../src/components/chat-log.js';
import { KeyHints } from '../src/components/key-hints.js';
import { ParticipantList } from '../src/components/participant-list.js';
import { SplitPanes } from '../src/components/split-panes.js';
import { Text } from '../src/components/text.js';
import type { RoomEvent } from '../src/engine/protocol.js';
import { NAME_PALETTE } from '../src/lib/identity.js';
import { framedBorder, theme } from '../src/lib/theme.js';

const INTERVAL_MS = Number(process.argv[2] ?? 700);

const hex = (name: string) => NAME_PALETTE.find((c) => c.name === name)?.hex;
const PEOPLE = {
  me: { name: 'mvega', color: hex('yellow') },
  ana: { name: 'Ana', color: hex('pink') },
  owl: { name: '🦉', color: hex('green') },
  wil: { name: 'Wilhelmi', color: hex('cyan') },
} as const;
type Who = keyof typeof PEOPLE;

type Step = { event: Exclude<RoomEvent['type'], 'debug'>; who?: Who; text: string } | { who: Who; text: string };

const LONG_WORD =
  'https://example.invalid/a-very-long-path/that-has-no-spaces-in-it-at-all/and-keeps-going/until-it-must-break';

/** The conversation, in order. */
const SCRIPT: Step[] = [
  { event: 'join', who: 'me', text: 'joined the room' },
  { event: 'join', who: 'ana', text: 'is in the room' },
  { who: 'ana', text: 'hola' },
  { who: 'me', text: '¿me oyes?' },
  {
    who: 'ana',
    text: 'sí, perfecto. Te oigo en estéreo y sin ruido de fondo, mejor que la última vez con el micro de la cámara.',
  },
  { event: 'join', who: 'owl', text: 'joined' },
  { who: 'owl', text: 'buenas' },
  { event: 'mute', who: 'owl', text: 'muted' },
  { who: 'me', text: 'un momento que comparto pantalla' },
  { event: 'screen', who: 'me', text: 'started screen sharing' },
  { who: 'ana', text: 'la veo' },
  { event: 'join', who: 'wil', text: 'joined' },
  { who: 'wil', text: 'perdón por el retraso, ¿por dónde vais?' },
  {
    who: 'me',
    text: 'estábamos con el layout del chat: ahora los participantes van a la derecha y el log se fundió con la conversación',
  },
  { who: 'ana', text: 'ok' },
  { event: 'info', text: 'Debug mode enabled' },
  { who: 'wil', text: LONG_WORD },
  { who: 'owl', text: 'eso no envuelve por palabras, se parte donde toca' },
  { event: 'mute', who: 'owl', text: 'unmuted' },
  { who: 'owl', text: 'ya' },
  { who: 'me', text: 'línea corta' },
  { who: 'ana', text: 'y otra' },
  {
    who: 'wil',
    text: 'y una más larga para que haya varias seguidas del mismo largo medio, que es lo habitual en una conversación',
  },
  { event: 'screen', who: 'me', text: 'stopped screen sharing' },
  { who: 'ana', text: '👋' },
  { event: 'leave', who: 'ana', text: 'left' },
  { who: 'wil', text: 'me quedo un rato más' },
  { event: 'info', text: 'Debug mode disabled' },
  { who: 'me', text: 'fin del guion; sigue desplazándote con ↑↓ y PgUp/PgDn, q para salir' },
];

function toEntry(step: Step, i: number, at: number): ChatEntry {
  const who = PEOPLE[('event' in step ? step.who : step.who) ?? 'me'];
  const named = 'event' in step ? step.who !== undefined : true;
  return {
    key: `${i}`,
    timestamp: at,
    kind: 'event' in step ? step.event : 'message',
    who: named ? who.name : undefined,
    color: named ? who.color : undefined,
    text: step.text,
  };
}

function Demo() {
  const { exit } = useApp();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      setEntries((current) => {
        if (current.length >= SCRIPT.length) return current;
        return [...current, toEntry(SCRIPT[current.length], current.length, Date.now())];
      });
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [paused]);

  useInput((input, key) => {
    if (input === 'q' || key.escape) exit();
    else if (input === ' ') setPaused((p) => !p);
    else if (input === 'r') setEntries([]);
    else if (key.tab) setFocused((f) => !f);
  });

  const fed = entries.length;
  const { rows } = useWindowSize();

  return (
    <Box
      height={rows}
      borderStyle="round"
      backgroundColor={theme.bg}
      {...framedBorder}
      flexDirection="column"
      overflowY="hidden"
    >
      <Box paddingX={1} gap={1} justifyContent="space-between">
        <Box gap={1}>
          <Text bold color={theme.accent}>
            OpenMeet <Text dimColor>chat demo</Text>
          </Text>
          <Text dimColor>|</Text>
          <Text>
            Room: <Text bold>demo</Text>
          </Text>
          <Text dimColor>|</Text>
          <Text>4p</Text>
        </Box>
        <Text dimColor>
          {fed}/{SCRIPT.length} lines{paused ? ' · paused' : fed < SCRIPT.length ? ' · feeding' : ' · done'}
        </Text>
      </Box>
      <SplitPanes
        chat={
          <>
            <ChatLog entries={entries} arrowsScroll={focused} />
            <ChatInput focused={focused} onSend={() => {}} />
          </>
        }
        people={
          <ParticipantList
            participants={[
              { id: 'ana', username: PEOPLE.ana.name, color: PEOPLE.ana.color, joinedAt: '' },
              { id: 'owl', username: PEOPLE.owl.name, color: PEOPLE.owl.color, joinedAt: '' },
              { id: 'wil', username: PEOPLE.wil.name, color: PEOPLE.wil.color, joinedAt: '' },
            ]}
            username={PEOPLE.me.name}
            color={PEOPLE.me.color ?? theme.text}
            isMuted={false}
            isVideoMuted
            videoEnabled
            isScreenSharing={false}
            remoteMuteStates={{ owl: true }}
            remoteVideoMuteStates={{ ana: false }}
            remoteScreenShareStates={{}}
            peerVideoOpen={{}}
            peerScreenOpen={{}}
            speakingStates={{ ana: true }}
            peerVolumes={{ ana: 1, owl: 1, wil: 0.7 }}
            selectedPeerIdx={0}
            connectionStats={{
              sendBitrateKbps: 128,
              recvBitrateKbps: 384,
              rttMs: 12,
              packetLossPercent: 0,
              peerRecvBitrateKbps: { ana: 128, owl: 128, wil: 128 },
              peerLatencyMs: { ana: 41, owl: 95, wil: 180 },
            }}
          />
        }
        footer={
          <Box paddingX={1}>
            <KeyHints
              hints={[
                { key: 'q', label: 'quit' },
                { key: 'tab', label: focused ? 'controls' : 'chat' },
                { key: '↑↓', label: 'scroll', disabled: !focused },
                { key: 'pgup/dn', label: 'scroll ×10' },
                { key: 'space', label: paused ? 'resume' : 'pause' },
                { key: 'r', label: 'restart' },
              ]}
            />
          </Box>
        }
      />
    </Box>
  );
}

const app = render(<Demo />, { alternateScreen: true, patchConsole: false });
await app.waitUntilExit();
process.exit(0);
