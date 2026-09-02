export type {
  AudioBackend,
  AudioBackendName,
  AudioBackendPreference,
  AudioDevice,
  AudioDeviceList,
  AudioDeviceSelection,
} from './backend.js';
export { createAudioBackend, parseBackendFlag, resolveBackendName, setActiveBackendName } from './backend.js';
export type { InputChannelPolicy } from './channels.js';
export { AudioManager } from './manager.js';
export type { CaptureProcessor } from './processors.js';
