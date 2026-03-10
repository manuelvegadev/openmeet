import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  getSavedAudioDevice,
  getSavedEchoCancellation,
  getSavedVideoDevice,
  setSavedAudioDevice,
  setSavedEchoCancellation,
  setSavedVideoDevice,
} from '@/lib/utils';

interface MediaState {
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  isSystemAudioSharing: boolean;
  echoCancellation: boolean;
  audioDeviceId: string;
  videoDeviceId: string;
  audioDevices: MediaDeviceInfo[];
  videoDevices: MediaDeviceInfo[];
}

interface Mixer {
  context: AudioContext;
  micSource: MediaStreamAudioSourceNode | null;
  systemSource: MediaStreamAudioSourceNode;
  destination: MediaStreamAudioDestinationNode;
}

function getAudioConstraints(echoCancellation: boolean, deviceId?: string): MediaTrackConstraints {
  return {
    echoCancellation,
    noiseSuppression: true,
    sampleRate: 48000,
    channelCount: 2,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

export function useMedia() {
  const [state, setState] = useState<MediaState>({
    stream: null,
    screenStream: null,
    isAudioEnabled: false,
    isVideoEnabled: false,
    isScreenSharing: false,
    isSystemAudioSharing: false,
    echoCancellation: getSavedEchoCancellation() ?? true,
    audioDeviceId: '',
    videoDeviceId: '',
    audioDevices: [],
    videoDevices: [],
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const acquiringAudioRef = useRef(false);

  // Keep the raw mic track separate from what goes into the stream
  const rawMicTrackRef = useRef<MediaStreamTrack | null>(null);
  const systemAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const mixerRef = useRef<Mixer | null>(null);

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioDevices = devices.filter((d) => d.kind === 'audioinput' && d.deviceId);
      const videoDevices = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
      setState((s) => ({ ...s, audioDevices, videoDevices }));
    } catch (err) {
      console.error('Failed to enumerate devices:', err);
    }
  }, []);

  useEffect(() => {
    enumerateDevices();
    navigator.mediaDevices.addEventListener('devicechange', enumerateDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', enumerateDevices);
    };
  }, [enumerateDevices]);

  // Helper: build a new stream from current video + given audio track
  const buildStream = useCallback((audioTrack: MediaStreamTrack | null) => {
    const currentStream = stateRef.current.stream;
    const videoTracks = currentStream?.getVideoTracks() ?? [];
    return new MediaStream([...videoTracks, ...(audioTrack ? [audioTrack] : [])]);
  }, []);

  // Helper: connect mic to mixer, return the mixed output track
  const connectMicToMixer = useCallback(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;

    // Disconnect old mic source
    if (mixer.micSource) {
      mixer.micSource.disconnect();
      mixer.micSource = null;
    }

    const micTrack = rawMicTrackRef.current;
    if (micTrack && micTrack.readyState !== 'ended' && micTrack.enabled) {
      const micSource = mixer.context.createMediaStreamSource(new MediaStream([micTrack]));
      micSource.connect(mixer.destination);
      mixer.micSource = micSource;
    }
  }, []);

  // Helper: get the current output audio track (mixed or raw mic)
  const getOutputAudioTrack = useCallback((): MediaStreamTrack | null => {
    if (mixerRef.current) {
      return mixerRef.current.destination.stream.getAudioTracks()[0] ?? null;
    }
    return rawMicTrackRef.current;
  }, []);

  // Start with video only — no audio capture, so macOS won't duck system volume
  const startMedia = useCallback(async () => {
    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    };

    const savedVideoId = getSavedVideoDevice();

    let stream: MediaStream | null = null;

    // Try saved device first with exact constraint
    if (savedVideoId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { ...videoConstraints, deviceId: { exact: savedVideoId } },
        });
      } catch {
        // Saved device unavailable, fall through to default
      }
    }

    // Fallback to default device
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraints,
        });
      } catch (err) {
        console.error('Failed to get video:', err);
        const emptyStream = new MediaStream();
        setState((s) => ({ ...s, stream: emptyStream, isAudioEnabled: false, isVideoEnabled: false }));
        return emptyStream;
      }
    }

    const videoTrack = stream.getVideoTracks()[0];
    const videoDeviceId = videoTrack?.getSettings().deviceId ?? '';
    if (videoDeviceId) setSavedVideoDevice(videoDeviceId);
    setState((s) => ({ ...s, stream, isAudioEnabled: false, isVideoEnabled: true, videoDeviceId }));
    await enumerateDevices();
    return stream;
  }, [enumerateDevices]);

  // Lazily acquire mic on first unmute, then toggle track.enabled after that
  const toggleAudio = useCallback(async () => {
    const { isAudioEnabled } = stateRef.current;

    if (!rawMicTrackRef.current || rawMicTrackRef.current.readyState === 'ended') {
      // First time: acquire mic
      if (acquiringAudioRef.current) return;
      acquiringAudioRef.current = true;
      try {
        const savedAudioId = getSavedAudioDevice();
        let audioStream: MediaStream | null = null;

        // Try saved device first with exact constraint
        if (savedAudioId) {
          try {
            audioStream = await navigator.mediaDevices.getUserMedia({
              audio: { ...getAudioConstraints(stateRef.current.echoCancellation), deviceId: { exact: savedAudioId } },
            });
          } catch {
            // Saved device unavailable, fall through
          }
        }

        if (!audioStream) {
          audioStream = await navigator.mediaDevices.getUserMedia({
            audio: getAudioConstraints(stateRef.current.echoCancellation),
          });
        }

        const audioTrack = audioStream.getAudioTracks()[0];
        const audioDeviceId = audioTrack.getSettings().deviceId ?? '';
        if (audioDeviceId) setSavedAudioDevice(audioDeviceId);
        rawMicTrackRef.current = audioTrack;

        if (mixerRef.current) {
          // Mixer active: connect mic to mixer, stream already has mixed track
          connectMicToMixer();
          setState((s) => ({ ...s, isAudioEnabled: true, audioDeviceId }));
        } else {
          // No mixer: put raw mic in stream
          const newStream = buildStream(audioTrack);
          setState((s) => ({ ...s, stream: newStream, isAudioEnabled: true, audioDeviceId }));
        }
        await enumerateDevices();
      } catch (err) {
        console.error('Failed to get microphone:', err);
        toast.error('Failed to access microphone');
      } finally {
        acquiringAudioRef.current = false;
      }
    } else {
      // Toggle existing mic
      const micTrack = rawMicTrackRef.current;
      const newEnabled = !isAudioEnabled;
      micTrack.enabled = newEnabled;

      if (mixerRef.current) {
        // Update mixer connection
        if (newEnabled) {
          connectMicToMixer();
        } else {
          // Disconnect mic from mixer (system audio continues)
          if (mixerRef.current.micSource) {
            mixerRef.current.micSource.disconnect();
            mixerRef.current.micSource = null;
          }
        }
        setState((s) => ({ ...s, isAudioEnabled: newEnabled }));
      } else {
        setState((s) => ({ ...s, isAudioEnabled: newEnabled }));
      }
    }
  }, [enumerateDevices, buildStream, connectMicToMixer]);

  const toggleVideo = useCallback(() => {
    const { stream } = stateRef.current;
    if (stream) {
      for (const t of stream.getVideoTracks()) {
        t.enabled = !t.enabled;
      }
      setState((s) => ({ ...s, isVideoEnabled: !s.isVideoEnabled }));
    }
  }, []);

  const switchAudioDevice = useCallback(
    async (deviceId: string) => {
      const { stream } = stateRef.current;
      if (!stream) return;

      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: getAudioConstraints(stateRef.current.echoCancellation, deviceId),
        });
        const newTrack = audioStream.getAudioTracks()[0];

        // Stop old mic track
        rawMicTrackRef.current?.stop();
        rawMicTrackRef.current = newTrack;

        setSavedAudioDevice(deviceId);

        if (mixerRef.current) {
          // Update mixer with new mic
          connectMicToMixer();
          setState((s) => ({ ...s, audioDeviceId: deviceId, isAudioEnabled: true }));
        } else {
          // No mixer: replace in stream
          const newStream = buildStream(newTrack);
          setState((s) => ({ ...s, stream: newStream, audioDeviceId: deviceId, isAudioEnabled: true }));
        }
      } catch (err) {
        console.error('Failed to switch audio device:', err);
      }
    },
    [buildStream, connectMicToMixer],
  );

  const switchVideoDevice = useCallback(
    async (deviceId: string) => {
      const { stream } = stateRef.current;
      if (!stream) return;

      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
        });
        const newTrack = videoStream.getVideoTracks()[0];

        // Stop old video tracks
        for (const t of stream.getVideoTracks()) {
          t.stop();
        }

        setSavedVideoDevice(deviceId);

        // Build new stream with existing audio output + new video
        const outputAudio = getOutputAudioTrack();
        const newStream = new MediaStream([...(outputAudio ? [outputAudio] : []), newTrack]);
        setState((s) => ({ ...s, stream: newStream, videoDeviceId: deviceId, isVideoEnabled: true }));
      } catch (err) {
        console.error('Failed to switch video device:', err);
      }
    },
    [getOutputAudioTrack],
  );

  const toggleEchoCancellation = useCallback(async () => {
    const { echoCancellation } = stateRef.current;
    const newValue = !echoCancellation;
    setSavedEchoCancellation(newValue);
    setState((s) => ({ ...s, echoCancellation: newValue }));
    const micTrack = rawMicTrackRef.current;
    if (micTrack) {
      try {
        await micTrack.applyConstraints({ echoCancellation: newValue });
      } catch (err) {
        console.error('Failed to apply echo cancellation constraint:', err);
      }
    }
  }, []);

  // --- System audio sharing ---

  const teardownSystemAudio = useCallback(() => {
    const mixer = mixerRef.current;
    if (mixer) {
      mixer.systemSource.disconnect();
      mixer.micSource?.disconnect();
      mixer.context.close();
      mixerRef.current = null;
    }

    systemAudioTrackRef.current?.stop();
    systemAudioTrackRef.current = null;

    // Revert stream audio to raw mic
    const micTrack = rawMicTrackRef.current;
    const hasMic = micTrack && micTrack.readyState !== 'ended';
    const newStream = buildStream(hasMic ? micTrack : null);
    setState((s) => ({
      ...s,
      stream: newStream,
      isSystemAudioSharing: false,
      isAudioEnabled: hasMic ? micTrack.enabled : false,
    }));
  }, [buildStream]);

  const startSystemAudio = useCallback(async () => {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true, // Chrome requires video for getDisplayMedia
      });

      // Stop video track — we only want the audio
      for (const t of displayStream.getVideoTracks()) {
        t.stop();
      }

      const systemTrack = displayStream.getAudioTracks()[0];
      if (!systemTrack) {
        toast.error('No audio available from selected source');
        return;
      }

      systemAudioTrackRef.current = systemTrack;

      // Create mixer
      const context = new AudioContext({ sampleRate: 48000 });
      const destination = context.createMediaStreamDestination();

      const systemSource = context.createMediaStreamSource(new MediaStream([systemTrack]));
      systemSource.connect(destination);

      // Connect mic if available and enabled
      let micSource: MediaStreamAudioSourceNode | null = null;
      const micTrack = rawMicTrackRef.current;
      if (micTrack && micTrack.readyState !== 'ended' && micTrack.enabled) {
        micSource = context.createMediaStreamSource(new MediaStream([micTrack]));
        micSource.connect(destination);
      }

      mixerRef.current = { context, systemSource, micSource, destination };

      // Listen for system audio track ending (user stops sharing in browser UI)
      systemTrack.addEventListener('ended', () => {
        teardownSystemAudio();
      });

      // Replace stream audio with mixed output
      const mixedTrack = destination.stream.getAudioTracks()[0];
      const newStream = buildStream(mixedTrack);
      setState((s) => ({ ...s, stream: newStream, isSystemAudioSharing: true }));
    } catch (err) {
      console.error('Failed to share system audio:', err);
    }
  }, [buildStream, teardownSystemAudio]);

  const stopSystemAudio = useCallback(() => {
    teardownSystemAudio();
  }, [teardownSystemAudio]);

  // --- Screen sharing ---

  const startScreenShare = useCallback(async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 4096 },
          height: { ideal: 2160 },
          frameRate: { ideal: 144 },
        },
        audio: true,
      });

      screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        setState((s) => ({ ...s, screenStream: null, isScreenSharing: false }));
      });

      setState((s) => ({ ...s, screenStream, isScreenSharing: true }));
      return screenStream;
    } catch (err) {
      console.error('Failed to start screen share:', err);
      return null;
    }
  }, []);

  const stopScreenShare = useCallback(() => {
    const { screenStream } = stateRef.current;
    if (screenStream) {
      for (const t of screenStream.getTracks()) {
        t.stop();
      }
    }
    setState((s) => ({ ...s, screenStream: null, isScreenSharing: false }));
  }, []);

  const stopMedia = useCallback(() => {
    const { stream, screenStream } = stateRef.current;
    if (stream) {
      for (const t of stream.getTracks()) {
        t.stop();
      }
    }
    if (screenStream) {
      for (const t of screenStream.getTracks()) {
        t.stop();
      }
    }

    // Clean up mixer
    const mixer = mixerRef.current;
    if (mixer) {
      mixer.systemSource.disconnect();
      mixer.micSource?.disconnect();
      mixer.context.close();
      mixerRef.current = null;
    }
    rawMicTrackRef.current?.stop();
    rawMicTrackRef.current = null;
    systemAudioTrackRef.current?.stop();
    systemAudioTrackRef.current = null;

    setState({
      stream: null,
      screenStream: null,
      isAudioEnabled: false,
      isVideoEnabled: false,
      isScreenSharing: false,
      isSystemAudioSharing: false,
      echoCancellation: true,
      audioDeviceId: '',
      videoDeviceId: '',
      audioDevices: [],
      videoDevices: [],
    });
  }, []);

  return {
    ...state,
    startMedia,
    stopMedia,
    toggleAudio,
    toggleVideo,
    switchAudioDevice,
    switchVideoDevice,
    toggleEchoCancellation,
    startSystemAudio,
    stopSystemAudio,
    startScreenShare,
    stopScreenShare,
  };
}
