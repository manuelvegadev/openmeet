declare module '@roamhq/wrtc' {
  interface RTCAudioSourceData {
    samples: Int16Array;
    sampleRate: number;
    bitsPerSample: number;
    channelCount: number;
    numberOfFrames: number;
  }

  interface RTCAudioSource {
    createTrack(): MediaStreamTrack;
    onData(data: RTCAudioSourceData): void;
  }

  interface RTCAudioSink {
    ondata: ((data: RTCAudioSourceData) => void) | null;
    stop(): void;
  }

  const wrtc: {
    RTCPeerConnection: any;
    RTCSessionDescription: any;
    RTCIceCandidate: any;
    MediaStream: any;
    nonstandard: {
      RTCAudioSource: new () => RTCAudioSource;
      RTCAudioSink: new (track: MediaStreamTrack) => RTCAudioSink;
    };
  };
  export default wrtc;
}
