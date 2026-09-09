import { Box, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useEffect, useState } from 'react';
import { type AudioDevice, listAudioDevices } from '../engine/client.js';
import { INPUT_CHANNEL_POLICIES } from '../lib/audio/channels.js';
import { isBroadcastDevice, resolveBroadcastDefault } from '../lib/audio/nvidia-broadcast.js';
import { listVideoDevices, type VideoDevice } from '../lib/devices.js';
import { getPlatformSupport } from '../lib/platform.js';
import { AUDIO_KBPS_STEPS, SCREEN_KBPS_STEPS } from '../lib/sdp.js';
import { type AppSettings, loadSettings, saveSettings } from '../lib/settings.js';
import { theme } from '../lib/theme.js';
import { RENDER_PAUSE_POLICIES } from '../lib/window-state.js';
import { BroadcastHint, inputPickerItems } from './broadcast.js';
import { KeyHints } from './key-hints.js';
import { Rule, Text } from './text.js';

interface SettingsViewProps {
  onBack: () => void;
}

const webcamSupported = getPlatformSupport().webcam;

type Step = 'menu' | 'pick-input' | 'pick-output' | 'pick-camera';

interface SettingRow {
  key: string;
  label: string;
  value: string;
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

  const allRows: SettingRow[] = [
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
      key: 'pause',
      label: 'Pause Rendering',
      value: `when ${settings.pauseRendering} (applies on next start)`,
      run: () => update({ pauseRendering: cycle(RENDER_PAUSE_POLICIES, settings.pauseRendering) }),
    },
  ];
  const rows = allRows.filter((row) => row.key !== 'camera' || webcamSupported);

  useInput((_input, key) => {
    if (step !== 'menu') {
      if (key.escape) setStep('menu');
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

  // Device selection sub-screens
  if (step === 'pick-input') {
    const items = inputPickerItems(devices.inputs);
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        <Text bold color={theme.accent}>
          Settings {'>'} Audio Input
        </Text>
        <Rule />
        <SelectInput
          items={items}
          onSelect={(item) => {
            update({ audioInputId: item.value === '__default__' ? null : item.value, devicesConfigured: true });
            setStep('menu');
          }}
        />
        <Text />
        <KeyHints
          hints={[
            { key: '↑↓', label: 'navigate' },
            { key: 'enter', label: 'select' },
            { key: 'esc', label: 'cancel' },
          ]}
        />
      </Box>
    );
  }

  if (step === 'pick-output') {
    const items = [
      { label: 'System Default', value: '__default__' },
      ...devices.outputs.map((d) => ({ label: d.name, value: d.id })),
    ];
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        <Text bold color={theme.accent}>
          Settings {'>'} Audio Output
        </Text>
        <Rule />
        <SelectInput
          items={items}
          onSelect={(item) => {
            update({ audioOutputId: item.value === '__default__' ? null : item.value, devicesConfigured: true });
            setStep('menu');
          }}
        />
        <Text />
        <KeyHints
          hints={[
            { key: '↑↓', label: 'navigate' },
            { key: 'enter', label: 'select' },
            { key: 'esc', label: 'cancel' },
          ]}
        />
      </Box>
    );
  }

  if (step === 'pick-camera') {
    const items = [
      { label: 'Default (0)', value: '__default__' },
      ...videoDevices.map((d) => ({ label: `[${d.id}] ${d.name}`, value: d.id })),
    ];
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        <Text bold color={theme.accent}>
          Settings {'>'} Camera
        </Text>
        <Rule />
        <SelectInput
          items={items}
          onSelect={(item) => {
            update({ videoDeviceId: item.value === '__default__' ? null : item.value });
            setStep('menu');
          }}
        />
        <Text />
        <KeyHints
          hints={[
            { key: '↑↓', label: 'navigate' },
            { key: 'enter', label: 'select' },
            { key: 'esc', label: 'cancel' },
          ]}
        />
      </Box>
    );
  }

  // Main settings menu
  const labelWidth = 18;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
      <Text bold color={theme.accent}>
        Settings
      </Text>
      <Rule />

      {!devicesLoaded ? (
        <Text color={theme.warn}>Loading devices...</Text>
      ) : (
        <Box flexDirection="column">
          {rows.map((row, idx) => {
            const selected = idx === selectedIdx;
            return (
              <Box key={row.key} gap={1}>
                <Text color={selected ? theme.accent : theme.text}>{selected ? '▸' : ' '}</Text>
                <Text bold={selected}>{row.label.padEnd(labelWidth)}</Text>
                {/* A disabled row stays muted even when selected: enter does nothing on it. */}
                <Text color={selected && !row.disabled ? theme.text : theme.muted}>{row.value}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={1}>
        <BroadcastHint inputs={devices.inputs} loaded={devicesLoaded} />
      </Box>

      <Box flexGrow={1} />
      <KeyHints
        hints={[
          { key: '↑↓', label: 'navigate' },
          { key: 'enter', label: 'change' },
          { key: 'esc', label: 'back' },
        ]}
      />
    </Box>
  );
}
