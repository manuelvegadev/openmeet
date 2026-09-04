import { platform, release } from 'node:os';
import type { AudioBackendName } from './audio/backend.js';

/**
 * What this build can do on the current OS. The package has one version number for every
 * platform; this label is how the UI says which features that version enables here.
 */
export interface PlatformSupport {
  /** Short OS name for headers. */
  name: string;
  /** Feature summary shown next to the version. */
  features: string;
  /** Whether video (webcam + screen share) is available on this OS. */
  video: boolean;
  /** Audio backend used when the user has not forced one. */
  defaultAudioBackend: AudioBackendName;
}

/**
 * Supported targets: Windows 11 and macOS 15 (Sequoia) or later. Older releases are not
 * blocked, only labelled as untested in `features`. `release()` is the kernel/NT version:
 * Darwin 24 is macOS 15, NT 10.0 build 22000 is the first Windows 11. An unparseable
 * release counts as supported.
 */
function withOsNote(features: string, minimumOs: string, minMajor: number, minBuild = 0): string {
  const [major, , build] = release().split('.').map(Number);
  const meets = !Number.isFinite(major) || major > minMajor || (major === minMajor && (build || 0) >= minBuild);
  return meets ? features : `${features} (untested here, needs ${minimumOs}+)`;
}

export function getPlatformSupport(): PlatformSupport {
  switch (platform()) {
    case 'darwin':
      return {
        name: 'macOS',
        features: withOsNote('audio, chat, video, screen share', 'macOS 15', 24),
        video: true,
        defaultAudioBackend: 'rtaudio',
      };
    case 'win32':
      return {
        name: 'Windows',
        features: withOsNote('audio, chat', 'Windows 11', 10, 22000),
        video: false,
        defaultAudioBackend: 'rtaudio',
      };
    case 'linux':
      return { name: 'Linux', features: 'best effort', video: true, defaultAudioBackend: 'sox' };
    default:
      return { name: platform(), features: 'unsupported', video: false, defaultAudioBackend: 'rtaudio' };
  }
}
