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
  /** Whether the ffmpeg/ffplay video pipeline is available on this OS (screen share, watching peers). */
  video: boolean;
  /** Whether webcam capture is implemented on this OS. */
  webcam: boolean;
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

/** Feature label from the capability flags, plus the OS-release note. */
function withFeatures(
  base: Omit<PlatformSupport, 'features'>,
  minimumOs: string,
  minMajor: number,
  minBuild = 0,
): PlatformSupport {
  const features = ['audio', 'chat', base.webcam && 'video', base.video && 'screen share'].filter(Boolean).join(', ');
  return { ...base, features: withOsNote(features, minimumOs, minMajor, minBuild) };
}

function compute(): PlatformSupport {
  switch (platform()) {
    case 'darwin':
      return withFeatures({ name: 'macOS', video: true, webcam: true, defaultAudioBackend: 'rtaudio' }, 'macOS 15', 24);
    case 'win32':
      return withFeatures(
        { name: 'Windows', video: true, webcam: false, defaultAudioBackend: 'rtaudio' },
        'Windows 11',
        10,
        22000,
      );
    case 'linux':
      return { name: 'Linux', features: 'best effort', video: true, webcam: true, defaultAudioBackend: 'sox' };
    default:
      return { name: platform(), features: 'unsupported', video: false, webcam: false, defaultAudioBackend: 'rtaudio' };
  }
}

let cached: PlatformSupport | null = null;

/** Constant for the process lifetime; computed once. */
export function getPlatformSupport(): PlatformSupport {
  cached ??= compute();
  return cached;
}
