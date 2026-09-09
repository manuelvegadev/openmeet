import { Box, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useEffect, useRef, useState } from 'react';
import type { AudioDevice } from '../engine/client.js';
import { MicTester, playTestTone } from '../lib/audio-test.js';
import { theme } from '../lib/theme.js';
import { KeyChip, KeyHints } from './key-hints.js';
import { MicBar } from './level-bar.js';
import { Rule, Text } from './text.js';

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

    tester.start({ input: selectedInput, output: selectedOutput });

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
        playTestTone({ input: selectedInput, output: selectedOutput });
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
        <Text bold color={theme.accent}>
          Audio Setup
        </Text>
        <Text>Loading audio devices...</Text>
      </Box>
    );
  }

  if (inputs.length === 0 && outputs.length === 0) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
        <Text bold color={theme.accent}>
          Audio Setup
        </Text>
        <Text />
        <Text>No specific audio devices found.</Text>
        <Text>Using system default devices.</Text>
        <Text />
        <Text>
          {/* The chip stays out of the dim wrapper so it keeps its full contrast. */}
          <Text dimColor>Press </Text>
          <KeyChip>enter</KeyChip>
          <Text dimColor> to continue</Text>
        </Text>
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
        <Text bold color={theme.accent}>
          Audio Setup
        </Text>
        <Rule />
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
        <KeyHints
          hints={[
            { key: '↑↓', label: 'navigate' },
            { key: 'enter', label: 'select' },
          ]}
        />
      </Box>
    );
  }

  if (step === 'output') {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color={theme.accent}>
          Audio Setup
        </Text>
        <Rule />
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
        <KeyHints
          hints={[
            { key: '↑↓', label: 'navigate' },
            { key: 'enter', label: 'select' },
          ]}
        />
      </Box>
    );
  }

  // Test step
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={theme.accent}>
        Audio Test
      </Text>
      <Rule />
      <Text>
        Input: <Text bold>{selectedInput?.name ?? 'System Default'}</Text>
      </Text>
      <Text>
        Output: <Text bold>{selectedOutput?.name ?? 'System Default'}</Text>
      </Text>
      <Text />
      <Text bold>Mic level:</Text>
      <Text>
        <MicBar level={micLevel} />
      </Text>
      <Text />
      <KeyHints
        hints={[
          { key: 't', label: 'test tone' },
          { key: 'enter', label: 'confirm' },
          { key: 'esc', label: 're-select' },
        ]}
      />
    </Box>
  );
}
