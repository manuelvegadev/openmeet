import { Box, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { type AudioDevice, listAudioDevices } from '../engine/client.js';
import { INPUT_CHANNEL_POLICIES } from '../lib/audio/channels.js';
import { isBroadcastDevice, resolveBroadcastDefault } from '../lib/audio/nvidia-broadcast.js';
import { listVideoDevices, type VideoDevice } from '../lib/devices.js';
import { bracketed } from '../lib/identity.js';
import { getPlatformSupport } from '../lib/platform.js';
import { AUDIO_KBPS_STEPS, SCREEN_KBPS_STEPS } from '../lib/sdp.js';
import { type AppSettings, loadSettings, saveSettings } from '../lib/settings.js';
import { theme } from '../lib/theme.js';
import { UPDATE_POLICIES } from '../lib/update.js';
import { RENDER_PAUSE_POLICIES } from '../lib/window-state.js';
import { BroadcastHint, inputPickerItems, SYSTEM_DEFAULT_ITEM } from './broadcast.js';
import type { KeyHint } from './key-hints.js';
import { ProfileSetup } from './profile-setup.js';
import { Screen } from './screen.js';
import { Select } from './select.js';
import { Pointer, Text } from './text.js';

interface SettingsViewProps {
  onBack: () => void;
}

const webcamSupported = getPlatformSupport().webcam;

type Picker = 'pick-input' | 'pick-output' | 'pick-camera';
type Step = 'menu' | 'profile' | Picker;

const PICK_HINTS: KeyHint[] = [
  { key: '↑↓', label: 'navigate' },
  { key: 'enter', label: 'select' },
  { key: 'esc', label: 'cancel' },
];
const DEFAULT = SYSTEM_DEFAULT_ITEM.value;

interface SettingRow {
  key: string;
  label: string;
  value: string;
  /** Draw the value in this colour rather than the text colour: the name row, in the name's colour. */
  valueColor?: string;
  /** What Enter does on this row. */
  run: () => void;
  /** Shown, but not actionable: something else already owns the choice. */
  disabled?: boolean;
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const [step, setStep] = useState<Step>('menu');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [devices, setDevices] = useState<{ inputs: AudioDevice[]; outputs: AudioDevice[] }>({
    inputs: [],
    outputs: [],
  });
  const [videoDevices, setVideoDevices] = useState<VideoDevice[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);

  useEffect(() => {
    listAudioDevices().then((d) => {
      setDevices(d);
      setVideoDevices(listVideoDevices());
      setDevicesLoaded(true);
    });
  }, []);

  const inputName = settings.audioInputId
    ? (devices.inputs.find((d) => d.id === settings.audioInputId)?.name ?? 'Unknown')
    : 'System Default';
  // What the engine will actually open, so the rows below describe the call you would get.
  const selectedInput = resolveBroadcastDefault(
    settings.audioInputId ? devices.inputs.find((d) => d.id === settings.audioInputId) : undefined,
    devices.inputs,
  );
  const broadcastActive = isBroadcastDevice(selectedInput);
  const outputName = settings.audioOutputId
    ? (devices.outputs.find((d) => d.id === settings.audioOutputId)?.name ?? 'Unknown')
    : 'System Default';

  const cameraName = settings.videoDeviceId
    ? (videoDevices.find((d) => d.id === settings.videoDeviceId)?.name ?? `Device ${settings.videoDeviceId}`)
    : 'Default (0)';

  const cycle = <T extends string>(list: readonly T[], current: T): T =>
    list[(list.indexOf(current) + 1) % list.length];
  /** Same idea for the bitrate steps, where the saved value may not be one of them. */
  const cycleNumber = (list: readonly number[], current: number): number =>
    list[(list.findIndex((v) => v >= current) + 1) % list.length];

  const update = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    saveSettings(patch);
    setSettings(next);
  };

  const name = settings.name ?? '';
  const color = settings.color ?? undefined;
  const allRows: SettingRow[] = [
    // Name and colour together: the same two screens as the first start, with the colour
    // picked on the name itself.
    { key: 'profile', label: 'Profile', value: bracketed(name), valueColor: color, run: () => setStep('profile') },
    { key: 'input', label: 'Audio Input', value: inputName, run: () => setStep('pick-input') },
    { key: 'output', label: 'Audio Output', value: outputName, run: () => setStep('pick-output') },
    { key: 'camera', label: 'Camera', value: cameraName, run: () => setStep('pick-camera') },
    {
      key: 'overlay',
      label: 'Video Overlay',
      value: settings.videoOverlay ? 'On' : 'Off',
      run: () => update({ videoOverlay: !settings.videoOverlay }),
    },
    {
      key: 'channels',
      label: 'Mic Channels',
      value: settings.audioInputChannels,
      run: () => update({ audioInputChannels: cycle(INPUT_CHANNEL_POLICIES, settings.audioInputChannels) }),
    },
    {
      key: 'noise',
      // Broadcast cleans the signal before any API we control ever sees it, so RNNoise on top
      // would only spend 0.22 ms a frame denoising what is already denoised.
      label: 'Noise Suppression',
      value: broadcastActive ? 'NVIDIA Broadcast (GPU)' : settings.noiseSuppression ? 'On (RNNoise, CPU)' : 'Off',
      run: () => update({ noiseSuppression: !settings.noiseSuppression }),
      disabled: broadcastActive,
    },
    {
      key: 'voice-gate',
      // The dot beside a name is this gate: on means that person is reaching the room.
      label: 'Voice Gate',
      value: settings.voiceGate ? 'On (silence is not sent)' : 'Off (always sending)',
      run: () => update({ voiceGate: !settings.voiceGate }),
    },
    {
      key: 'send-kbps',
      label: 'Audio Send',
      value: `${settings.audioSendKbps} kbps (applies on next join)`,
      run: () => update({ audioSendKbps: cycleNumber(AUDIO_KBPS_STEPS, settings.audioSendKbps) }),
    },
    {
      key: 'receive-kbps',
      label: 'Audio Receive',
      value: `${settings.audioReceiveKbps} kbps (applies on next join)`,
      run: () => update({ audioReceiveKbps: cycleNumber(AUDIO_KBPS_STEPS, settings.audioReceiveKbps) }),
    },
    {
      key: 'screen-send-kbps',
      label: 'Screen Send',
      value: `${settings.screenSendKbps} kbps per peer at 1080p (applies on next join)`,
      run: () => update({ screenSendKbps: cycleNumber(SCREEN_KBPS_STEPS, settings.screenSendKbps) }),
    },
    {
      key: 'screen-receive-kbps',
      label: 'Screen Receive',
      value: `${settings.screenReceiveKbps} kbps from each peer (applies on next join)`,
      run: () => update({ screenReceiveKbps: cycleNumber(SCREEN_KBPS_STEPS, settings.screenReceiveKbps) }),
    },
    {
      key: 'auto-update',
      label: 'Updates',
      // The wording is what each one does, not what it is called: nobody should have to
      // guess whether "auto" means it asks first.
      value: {
        auto: 'install on exit',
        notify: 'tell me, do not install',
        off: 'do not check',
      }[settings.autoUpdate],
      run: () => update({ autoUpdate: cycle(UPDATE_POLICIES, settings.autoUpdate) }),
    },
    {
      key: 'pause',
      label: 'Pause Rendering',
      value: `when ${settings.pauseRendering} (applies on next start)`,
      run: () => update({ pauseRendering: cycle(RENDER_PAUSE_POLICIES, settings.pauseRendering) }),
    },
  ];
  const rows = allRows.filter((row) => row.key !== 'camera' || webcamSupported);

  /** The three device pickers: one screen, three tables. */
  const PICKERS: Record<
    Picker,
    { title: string; items: () => { label: string; value: string }[]; apply: (v: string) => void }
  > = {
    'pick-input': {
      title: 'Audio Input',
      items: () => inputPickerItems(devices.inputs),
      apply: (v) => update({ audioInputId: v === DEFAULT ? null : v, devicesConfigured: true }),
    },
    'pick-output': {
      title: 'Audio Output',
      items: () => [SYSTEM_DEFAULT_ITEM, ...devices.outputs.map((d) => ({ label: d.name, value: d.id }))],
      apply: (v) => update({ audioOutputId: v === DEFAULT ? null : v, devicesConfigured: true }),
    },
    'pick-camera': {
      title: 'Camera',
      items: () => [
        { label: 'Default (0)', value: DEFAULT },
        ...videoDevices.map((d) => ({ label: `[${d.id}] ${d.name}`, value: d.id })),
      ],
      apply: (v) => update({ videoDeviceId: v === DEFAULT ? null : v }),
    },
  };

  useInput((_input, key) => {
    if (step !== 'menu') {
      // ProfileSetup owns Escape on its two steps (back to the name, then out).
      if (key.escape && step !== 'profile') setStep('menu');
      return;
    }

    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setSelectedIdx((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIdx((prev) => Math.min(rows.length - 1, prev + 1));
      return;
    }
    if (key.return) {
      const row = rows[selectedIdx];
      if (!row.disabled) row.run();
    }
  });

  if (step === 'profile') {
    return (
      <ProfileSetup
        initial={color ? { name, color } : null}
        onDone={(id) => {
          update(id);
          setStep('menu');
        }}
        onCancel={() => setStep('menu')}
      />
    );
  }

  if (step !== 'menu') {
    const picker = PICKERS[step];
    return (
      <Screen title={`Settings > ${picker.title}`} hints={PICK_HINTS}>
        <Select
          items={picker.items()}
          onSelect={(item) => {
            picker.apply(item.value);
            setStep('menu');
          }}
        />
      </Screen>
    );
  }

  // Main settings menu
  const labelWidth = 18;

  return (
    <Screen
      title="Settings"
      hints={[
        { key: '↑↓', label: 'navigate' },
        { key: 'enter', label: 'change' },
        { key: 'esc', label: 'back' },
      ]}
    >
      {!devicesLoaded ? (
        <Text color={theme.warn}>Loading devices...</Text>
      ) : (
        <Box flexDirection="column">
          {rows.map((row, idx) => {
            const selected = idx === selectedIdx;
            return (
              <Box key={row.key} gap={1}>
                <Pointer on={selected} />
                <Text bold={selected}>{row.label.padEnd(labelWidth)}</Text>
                {/* A disabled row stays muted even when selected: enter does nothing on it. */}
                <Text color={row.valueColor ?? (selected && !row.disabled ? theme.text : theme.muted)}>
                  {row.value}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={1}>
        <BroadcastHint inputs={devices.inputs} loaded={devicesLoaded} />
      </Box>
    </Screen>
  );
}
