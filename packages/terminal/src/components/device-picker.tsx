import { Box, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { AudioDevice } from '../engine/client.js';
import { findBroadcastInput } from '../lib/audio/nvidia-broadcast.js';
import { MicTester, playTestTone } from '../lib/audio-test.js';
import { theme } from '../lib/theme.js';
import { BroadcastHint, inputPickerItems } from './broadcast.js';
import { KeyChip } from './key-hints.js';
import { MicBar } from './level-bar.js';
import { Screen } from './screen.js';
import { Select } from './select.js';
import { Text } from './text.js';

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
  // Mic tester lifecycle — active only during 'test' step
  useEffect(() => {
    if (step !== 'test') {
      testerRef.current?.stop();
      testerRef.current = null;
      setMicLevel(0);
      return;
    }

    const tester = new MicTester();
    testerRef.current = tester;

    let lastUpdate = 0;
    tester.setLevelCallback((rms) => {
      // Already smoothed by the engine's ballistics; just cap the renders.
      const now = Date.now();
      if (now - lastUpdate > 80) {
        lastUpdate = now;
        setMicLevel(rms);
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
        <Box height={1} />
        <Text>No specific audio devices found.</Text>
        <Text>Using system default devices.</Text>
        <Box height={1} />
        <Text>
          {/* The chip stays out of the dim wrapper so it keeps its full contrast. */}
          <Text dimColor>Press </Text>
          <KeyChip>enter</KeyChip>
          <Text dimColor> to continue</Text>
        </Text>
      </Box>
    );
  }

  const broadcast = findBroadcastInput(inputs);
  const inputItems = inputPickerItems(inputs);

  const outputItems = [
    { label: 'System Default', value: '__default__' },
    ...outputs.map((d) => ({ label: d.name, value: d.id })),
  ];

  // A saved choice wins; on a first run the GPU path is the recommendation, so start there.
  const firstRunIndex = broadcast ? inputItems.findIndex((item) => item.value === broadcast.id) : 0;
  const savedInputIndex = savedInputId ? inputItems.findIndex((item) => item.value === savedInputId) : firstRunIndex;
  const savedOutputIndex = savedOutputId ? outputItems.findIndex((item) => item.value === savedOutputId) : 0;

  if (step === 'input') {
    return (
      <Screen
        title="Audio Setup"
        hints={[
          { key: '↑↓', label: 'navigate' },
          { key: 'enter', label: 'select' },
        ]}
      >
        <Text bold>Input (Microphone):</Text>
        <Select
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
        <BroadcastHint inputs={inputs} loaded={!loading} />
      </Screen>
    );
  }

  if (step === 'output') {
    return (
      <Screen
        title="Audio Setup"
        hints={[
          { key: '↑↓', label: 'navigate' },
          { key: 'enter', label: 'select' },
        ]}
      >
        <Text>
          Input: <Text bold>{selectedInput?.name ?? 'System Default'}</Text>
        </Text>
        <Text bold>Output (Speakers):</Text>
        <Select
          items={outputItems}
          initialIndex={savedOutputIndex >= 0 ? savedOutputIndex : 0}
          onSelect={(item) => {
            const device = outputs.find((d) => d.id === item.value);
            setSelectedOutput(device);
            setStep('test');
          }}
        />
      </Screen>
    );
  }

  // Test step
  return (
    <Screen
      title="Audio Test"
      hints={[
        { key: 't', label: 'test tone' },
        { key: 'enter', label: 'confirm' },
        { key: 'esc', label: 're-select' },
      ]}
    >
      <Text>
        Input: <Text bold>{selectedInput?.name ?? 'System Default'}</Text>
      </Text>
      <Text>
        Output: <Text bold>{selectedOutput?.name ?? 'System Default'}</Text>
      </Text>
      <Text bold>Mic level:</Text>
      <Text>
        <MicBar level={micLevel} />
      </Text>
    </Screen>
  );
}
