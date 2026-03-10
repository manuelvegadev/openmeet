import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const EMOJI_KEY = 'openmeet-emoji';

const EMOJI_POOL = [
  // Animals
  '\u{1F436}',
  '\u{1F431}',
  '\u{1F43B}',
  '\u{1F43C}',
  '\u{1F428}',
  '\u{1F435}',
  '\u{1F981}',
  '\u{1F984}',
  '\u{1F98A}',
  '\u{1F989}',
  '\u{1F427}',
  '\u{1F40A}',
  '\u{1F422}',
  '\u{1F41D}',
  '\u{1F419}',
  '\u{1F433}',
  '\u{1F418}',
  '\u{1F992}',
  '\u{1F98E}',
  '\u{1F40C}',
  '\u{1F99C}',
  '\u{1F9A9}',
  '\u{1F40B}',
  '\u{1F99A}',
  // Fruits
  '\u{1F34E}',
  '\u{1F34A}',
  '\u{1F34B}',
  '\u{1F349}',
  '\u{1F353}',
  '\u{1F351}',
  '\u{1F352}',
  '\u{1F347}',
  '\u{1F34D}',
  '\u{1F95D}',
  '\u{1F951}',
  '\u{1FAD0}',
  '\u{1F965}',
  '\u{1F346}',
  '\u{1F955}',
  // Funny faces
  '\u{1F92A}',
  '\u{1F913}',
  '\u{1F978}',
  '\u{1F920}',
  '\u{1F47B}',
  '\u{1F916}',
  '\u{1F47D}',
  '\u{1F9B8}',
  '\u{1F9DB}',
  '\u{1F9D9}',
  '\u{1F9DA}',
  '\u{1F9DC}',
  '\u{1F9DE}',
  '\u{1F383}',
  '\u{1F47E}',
  '\u{1F479}',
];

export function getOrCreateEmoji(): string {
  const stored = localStorage.getItem(EMOJI_KEY);
  if (stored) return stored;
  const emoji = EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
  localStorage.setItem(EMOJI_KEY, emoji);
  return emoji;
}

// Device preference persistence
const AUDIO_DEVICE_KEY = 'openmeet-audio-device';
const VIDEO_DEVICE_KEY = 'openmeet-video-device';

export function getSavedAudioDevice(): string | null {
  return localStorage.getItem(AUDIO_DEVICE_KEY);
}

export function setSavedAudioDevice(deviceId: string): void {
  localStorage.setItem(AUDIO_DEVICE_KEY, deviceId);
}

export function getSavedVideoDevice(): string | null {
  return localStorage.getItem(VIDEO_DEVICE_KEY);
}

export function setSavedVideoDevice(deviceId: string): void {
  localStorage.setItem(VIDEO_DEVICE_KEY, deviceId);
}

const ECHO_CANCELLATION_KEY = 'openmeet-echo-cancellation';

export function getSavedEchoCancellation(): boolean | null {
  const val = localStorage.getItem(ECHO_CANCELLATION_KEY);
  if (val === null) return null;
  return val === 'true';
}

export function setSavedEchoCancellation(enabled: boolean): void {
  localStorage.setItem(ECHO_CANCELLATION_KEY, String(enabled));
}
