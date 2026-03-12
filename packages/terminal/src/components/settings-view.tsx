import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useEffect, useState } from 'react';
import type { AudioDevice, VideoDevice } from '../lib/devices.js';
import { listAudioDevices, listVideoDevices } from '../lib/devices.js';
import { type AppSettings, loadSettings, saveSettings } from '../lib/settings.js';

interface SettingsViewProps {
  onBack: () => void;
}

type Step = 'menu' | 'pick-input' | 'pick-output' | 'pick-camera';

interface SettingRow {
  key: string;
  label: string;
  value: string;
  action: 'pick-input' | 'pick-output' | 'pick-camera' | 'toggle-overlay';
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
  const outputName = settings.audioOutputId
    ? (devices.outputs.find((d) => d.id === settings.audioOutputId)?.name ?? 'Unknown')
    : 'System Default';

  const cameraName = settings.videoDeviceId
    ? (videoDevices.find((d) => d.id === settings.videoDeviceId)?.name ?? `Device ${settings.videoDeviceId}`)
    : 'Default (0)';

  const rows: SettingRow[] = [
    { key: 'input', label: 'Audio Input', value: inputName, action: 'pick-input' },
    { key: 'output', label: 'Audio Output', value: outputName, action: 'pick-output' },
    { key: 'camera', label: 'Camera', value: cameraName, action: 'pick-camera' },
    { key: 'overlay', label: 'Video Overlay', value: settings.videoOverlay ? 'On' : 'Off', action: 'toggle-overlay' },
  ];

  const update = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    saveSettings(patch);
    setSettings(next);
  };

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
      if (row.action === 'toggle-overlay') {
        update({ videoOverlay: !settings.videoOverlay });
      } else if (row.action === 'pick-input') {
        setStep('pick-input');
      } else if (row.action === 'pick-output') {
        setStep('pick-output');
      } else if (row.action === 'pick-camera') {
        setStep('pick-camera');
      }
    }
  });

  // Device selection sub-screens
  if (step === 'pick-input') {
    const items = [
      { label: 'System Default', value: '__default__' },
      ...devices.inputs.map((d) => ({ label: d.name, value: d.id })),
    ];
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        <Text bold color="blue">
          Settings {'>'} Audio Input
        </Text>
        <Box height={1} overflow="hidden">
          <Text dimColor>{'─'.repeat(200)}</Text>
        </Box>
        <SelectInput
          items={items}
          onSelect={(item) => {
            update({ audioInputId: item.value === '__default__' ? null : item.value, devicesConfigured: true });
            setStep('menu');
          }}
        />
        <Text />
        <Text dimColor>[↑↓] navigate [Enter] select [Esc] cancel</Text>
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
        <Text bold color="blue">
          Settings {'>'} Audio Output
        </Text>
        <Box height={1} overflow="hidden">
          <Text dimColor>{'─'.repeat(200)}</Text>
        </Box>
        <SelectInput
          items={items}
          onSelect={(item) => {
            update({ audioOutputId: item.value === '__default__' ? null : item.value, devicesConfigured: true });
            setStep('menu');
          }}
        />
        <Text />
        <Text dimColor>[↑↓] navigate [Enter] select [Esc] cancel</Text>
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
        <Text bold color="blue">
          Settings {'>'} Camera
        </Text>
        <Box height={1} overflow="hidden">
          <Text dimColor>{'─'.repeat(200)}</Text>
        </Box>
        <SelectInput
          items={items}
          onSelect={(item) => {
            update({ videoDeviceId: item.value === '__default__' ? null : item.value });
            setStep('menu');
          }}
        />
        <Text />
        <Text dimColor>[↑↓] navigate [Enter] select [Esc] cancel</Text>
      </Box>
    );
  }

  // Main settings menu
  const labelWidth = 18;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
      <Text bold color="blue">
        Settings
      </Text>
      <Box height={1} overflow="hidden">
        <Text dimColor>{'─'.repeat(200)}</Text>
      </Box>

      {!devicesLoaded ? (
        <Text color="yellow">Loading devices...</Text>
      ) : (
        <Box flexDirection="column">
          {rows.map((row, idx) => {
            const selected = idx === selectedIdx;
            return (
              <Box key={row.key} gap={1}>
                <Text color={selected ? 'blue' : undefined}>{selected ? '▸' : ' '}</Text>
                <Text bold={selected}>{row.label.padEnd(labelWidth)}</Text>
                <Text color={selected ? 'white' : 'gray'}>{row.value}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      <Box flexGrow={1} />
      <Text dimColor>[↑↓] navigate [Enter] change [Esc] back</Text>
    </Box>
  );
}
