import { platform } from 'node:os';
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

export function getPlatformSupport(): PlatformSupport {
  switch (platform()) {
    case 'darwin':
      return {
        name: 'macOS',
        features: 'audio, chat, video, screen share',
        video: true,
        defaultAudioBackend: 'rtaudio',
      };
    case 'win32':
      return { name: 'Windows', features: 'audio, chat', video: false, defaultAudioBackend: 'rtaudio' };
    case 'linux':
      return { name: 'Linux', features: 'best effort', video: true, defaultAudioBackend: 'sox' };
    default:
      return { name: platform(), features: 'unsupported', video: false, defaultAudioBackend: 'rtaudio' };
  }
}
