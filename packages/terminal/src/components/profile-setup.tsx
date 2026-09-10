import { Box, useInput } from 'ink';
import { useState } from 'react';
import { clampName, finishName, type Identity, NAME_MAX_CELLS } from '../lib/identity.js';
import { ColorPicker } from './color-picker.js';
import { Name } from './name.js';
import { Screen } from './screen.js';
import { Text } from './text.js';
import { TextInput } from './text-input.js';

interface ProfileSetupProps {
  /** What is already set, when editing rather than starting fresh. */
  initial?: Identity | null;
  onDone: (identity: Identity) => void;
  /** Escape. Absent on the first start, where there is nothing to go back to. */
  onCancel?: () => void;
}

/**
 * The first thing the app asks, once: a name, then a colour to draw it in. Two steps so the
 * colour is chosen on the name itself — the picker previews `[Mario]` in every colour — and
 * the second step can go back to the first with Escape.
 */
export function ProfileSetup({ initial, onDone, onCancel }: ProfileSetupProps) {
  const [step, setStep] = useState<'name' | 'color'>('name');
  const [name, setName] = useState(initial?.name ?? '');
  const finished = finishName(name);

  useInput((_input, key) => {
    if (!key.escape) return;
    if (step === 'color') setStep('name');
    else onCancel?.();
  });

  if (step === 'color') {
    return (
      <Screen
        title="Your colour"
        hints={[
          { key: '↑↓', label: 'colour' },
          { key: 'enter', label: 'pick' },
          { key: 'esc', label: 'back to name' },
        ]}
      >
        <Text dimColor>How {finished} shows up for everyone. ↑↓ to look, enter to pick.</Text>
        <Box height={1} />
        <ColorPicker name={finished} value={initial?.color} onSelect={(color) => onDone({ name: finished, color })} />
      </Screen>
    );
  }

  return (
    <Screen
      title="Your name"
      hints={[{ key: 'enter', label: 'next: colour' }, ...(onCancel ? [{ key: 'esc', label: 'cancel' }] : [])]}
    >
      <Text dimColor>
        What others will read and say. Up to {NAME_MAX_CELLS} characters; you can change it later in settings.
      </Text>
      <Box height={1} />
      <Box>
        <Text bold>Name: </Text>
        <TextInput
          value={name}
          onChange={(v) => setName(clampName(v))}
          placeholder="Mario"
          onSubmit={() => {
            if (finished) setStep('color');
          }}
        />
      </Box>
      <Box height={1} />
      <Text>
        {finished ? (
          <>
            <Text dimColor>You will show up as </Text>
            <Name name={finished} color={initial?.color} />
          </>
        ) : (
          <Text dimColor>Type a name to continue</Text>
        )}
      </Text>
    </Screen>
  );
}
