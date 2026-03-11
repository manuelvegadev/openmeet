import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useEffect, useRef, useState } from 'react';
import { MicTester, playTestTone } from '../lib/audio-test.js';
import type { AudioDevice } from '../lib/devices.js';
import { getDeviceEnv } from '../lib/devices.js';

const BAR_WIDTH = 30;
const MAX_RMS = 8000;

function renderBar(level: number): string {
  const normalized = Math.min(level / MAX_RMS, 1);
  const filled = Math.round(normalized * BAR_WIDTH);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(BAR_WIDTH - filled);
}

function barColor(level: number): string {
  const normalized = Math.min(level / MAX_RMS, 1);
  if (normalized > 0.75) return 'red';
  if (normalized > 0.4) return 'yellow';
  return 'green';
}

interface DevicePickerProps {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
  loading: boolean;
  savedInputId: string | null;
  savedOutputId: string | null;
  onConfirm: (input?: AudioDevice, output?: AudioDevice) => void;
}

type Step = 'input' | 'output' | 'test';

export function DevicePicker({ inputs, outputs, loading, savedInputId, savedOutputId, onConfirm }: DevicePickerProps) {
  const [step, setStep] = useState<Step>('input');
  const [selectedInput, setSelectedInput] = useState<AudioDevice | undefined>();
  const [selectedOutput, setSelectedOutput] = useState<AudioDevice | undefined>();
  const [micLevel, setMicLevel] = useState(0);
  const testerRef = useRef<MicTester | null>(null);
  const smoothedRef = useRef(0);

  // Mic tester lifecycle — active only during 'test' step
  useEffect(() => {
    if (step !== 'test') {
      testerRef.current?.stop();
      testerRef.current = null;
      smoothedRef.current = 0;
      setMicLevel(0);
      return;
    }

    const envs = getDeviceEnv(selectedInput, selectedOutput);
    const tester = new MicTester();
    testerRef.current = tester;

    let lastUpdate = 0;
    tester.setLevelCallback((rms) => {
      smoothedRef.current = smoothedRef.current * 0.7 + rms * 0.3;
      const now = Date.now();
      if (now - lastUpdate > 80) {
        lastUpdate = now;
        setMicLevel(smoothedRef.current);
      }
    });

    tester.start(envs);

    return () => {
      tester.stop();
    };
  }, [step, selectedInput, selectedOutput]);

  useInput((input, key) => {
    if (loading) return;

    // No devices — Enter to continue
    if (inputs.length === 0 && outputs.length === 0) {
      if (key.return) onConfirm();
      return;
    }

    // Test step keybindings
    if (step === 'test') {
      if (input === 't') {
        const envs = getDeviceEnv(selectedInput, selectedOutput);
        playTestTone(envs);
      }
      if (key.return) {
        onConfirm(selectedInput, selectedOutput);
      }
      if (key.escape) {
        setStep('input');
      }
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
        <Text bold color="blue">
          Audio Setup
        </Text>
        <Text>Loading audio devices...</Text>
      </Box>
    );
  }

  if (inputs.length === 0 && outputs.length === 0) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
        <Text bold color="blue">
          Audio Setup
        </Text>
        <Text />
        <Text>No specific audio devices found.</Text>
        <Text>Using system default devices.</Text>
        <Text />
        <Text dimColor>Press [Enter] to continue</Text>
      </Box>
    );
  }

  const inputItems = [
    { label: 'System Default', value: '__default__' },
    ...inputs.map((d) => ({ label: d.name, value: d.id })),
  ];

  const outputItems = [
    { label: 'System Default', value: '__default__' },
    ...outputs.map((d) => ({ label: d.name, value: d.id })),
  ];

  const savedInputIndex = savedInputId ? inputItems.findIndex((item) => item.value === savedInputId) : 0;
  const savedOutputIndex = savedOutputId ? outputItems.findIndex((item) => item.value === savedOutputId) : 0;

  if (step === 'input') {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="blue">
          Audio Setup
        </Text>
        <Box height={1} overflow="hidden">
          <Text dimColor>{'─'.repeat(200)}</Text>
        </Box>
        <Text bold>Input (Microphone):</Text>
        <SelectInput
          items={inputItems}
          initialIndex={savedInputIndex >= 0 ? savedInputIndex : 0}
          onSelect={(item) => {
            const device = inputs.find((d) => d.id === item.value);
            setSelectedInput(device);
            if (outputs.length === 0) {
              setSelectedOutput(undefined);
              setStep('test');
            } else {
              setStep('output');
            }
          }}
        />
        <Text />
        <Text dimColor>[↑↓] navigate [Enter] select</Text>
      </Box>
    );
  }

  if (step === 'output') {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="blue">
          Audio Setup
        </Text>
        <Box height={1} overflow="hidden">
          <Text dimColor>{'─'.repeat(200)}</Text>
        </Box>
        <Text>
          Input: <Text bold>{selectedInput?.name ?? 'System Default'}</Text>
        </Text>
        <Text />
        <Text bold>Output (Speakers):</Text>
        <SelectInput
          items={outputItems}
          initialIndex={savedOutputIndex >= 0 ? savedOutputIndex : 0}
          onSelect={(item) => {
            const device = outputs.find((d) => d.id === item.value);
            setSelectedOutput(device);
            setStep('test');
          }}
        />
        <Text />
        <Text dimColor>[↑↓] navigate [Enter] select</Text>
      </Box>
    );
  }

  // Test step
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="blue">
        Audio Test
      </Text>
      <Box height={1} overflow="hidden">
        <Text dimColor>{'─'.repeat(200)}</Text>
      </Box>
      <Text>
        Input: <Text bold>{selectedInput?.name ?? 'System Default'}</Text>
      </Text>
      <Text>
        Output: <Text bold>{selectedOutput?.name ?? 'System Default'}</Text>
      </Text>
      <Text />
      <Text bold>Mic level:</Text>
      <Text>
        <Text color={barColor(micLevel)}>{renderBar(micLevel)}</Text>
      </Text>
      <Text />
      <Text dimColor>[t] play test tone [Enter] confirm [Esc] re-select</Text>
    </Box>
  );
}
