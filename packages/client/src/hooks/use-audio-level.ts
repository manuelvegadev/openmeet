import { useEffect, useRef, useState } from 'react';

export function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  const contextRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setLevel(0);
      return;
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack || audioTrack.readyState === 'ended') {
      setLevel(0);
      return;
    }

    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;

    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);

    // Connect through a silent gain node to destination so Chrome
    // processes audio data for remote WebRTC streams
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    analyser.connect(silentGain);
    silentGain.connect(context.destination);

    contextRef.current = context;

    const dataArray = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(dataArray);
      let peak = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = Math.abs(dataArray[i] - 128) / 128;
        if (v > peak) peak = v;
      }
      setLevel(peak);
    };

    intervalRef.current = window.setInterval(tick, 100);

    return () => {
      clearInterval(intervalRef.current);
      source.disconnect();
      silentGain.disconnect();
      analyser.disconnect();
      context.close();
      contextRef.current = null;
    };
  }, [stream]);

  return level;
}
