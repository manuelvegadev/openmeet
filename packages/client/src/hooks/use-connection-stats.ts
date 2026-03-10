import { useEffect, useRef, useState } from 'react';

export interface ConnectionStats {
  // Video
  videoBitrate: number;
  resolution: string;
  framerate: number;
  videoCodec: string;
  // Audio
  hasAudio: boolean;
  audioBitrate: number;
  audioCodec: string;
  audioSampleRate: number;
  // General
  packetLoss: number;
  roundTripTime: number;
  connectionState: string;
}

interface PrevStats {
  videoBytes: number;
  audioBytes: number;
  packetsSent: number;
  packetsReceived: number;
  packetsLost: number;
  timestamp: number;
}

export function useConnectionStats(
  pc: RTCPeerConnection | undefined,
  direction: 'inbound' | 'outbound' = 'inbound',
  intervalMs = 2000,
): ConnectionStats | null {
  const [stats, setStats] = useState<ConnectionStats | null>(null);
  const prevRef = useRef<PrevStats | null>(null);

  useEffect(() => {
    if (!pc) {
      setStats(null);
      prevRef.current = null;
      return;
    }

    const poll = async () => {
      try {
        const report = await pc.getStats();

        let videoBytes = 0;
        let audioBytes = 0;
        let packetsSent = 0;
        let packetsReceived = 0;
        let packetsLost = 0;
        let roundTripTime = 0;
        let resolution = '';
        let framerate = 0;
        let audioSampleRate = 0;
        let hasAudio = false;

        let videoCodecId = '';
        let audioCodecId = '';

        const codecs = new Map<string, { mimeType: string; clockRate: number }>();

        // First pass: collect all codec entries
        for (const stat of report.values()) {
          if (stat.type === 'codec') {
            codecs.set(stat.id, {
              mimeType: stat.mimeType ?? '',
              clockRate: stat.clockRate ?? 0,
            });
          }
        }

        // Second pass: collect RTP and candidate stats
        for (const stat of report.values()) {
          if (direction === 'inbound') {
            if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
              videoBytes += stat.bytesReceived ?? 0;
              packetsReceived += stat.packetsReceived ?? 0;
              packetsLost += stat.packetsLost ?? 0;
              if (stat.frameWidth && stat.frameHeight) {
                resolution = `${stat.frameWidth}x${stat.frameHeight}`;
              }
              if (stat.framesPerSecond) {
                framerate = Math.round(stat.framesPerSecond);
              }
              if (stat.codecId) videoCodecId = stat.codecId;
            }

            if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
              hasAudio = true;
              audioBytes += stat.bytesReceived ?? 0;
              packetsReceived += stat.packetsReceived ?? 0;
              packetsLost += stat.packetsLost ?? 0;
              if (stat.codecId) audioCodecId = stat.codecId;
            }

            if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
              if (stat.currentRoundTripTime != null) {
                roundTripTime = Math.round(stat.currentRoundTripTime * 1000);
              }
            }
          } else {
            if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
              videoBytes += stat.bytesSent ?? 0;
              packetsSent += stat.packetsSent ?? 0;
              if (stat.frameWidth && stat.frameHeight) {
                resolution = `${stat.frameWidth}x${stat.frameHeight}`;
              }
              if (stat.framesPerSecond) {
                framerate = Math.round(stat.framesPerSecond);
              }
              if (stat.codecId) videoCodecId = stat.codecId;
            }

            if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
              hasAudio = true;
              audioBytes += stat.bytesSent ?? 0;
              packetsSent += stat.packetsSent ?? 0;
              if (stat.codecId) audioCodecId = stat.codecId;
            }

            if (stat.type === 'remote-inbound-rtp') {
              packetsLost += stat.packetsLost ?? 0;
              packetsReceived += stat.packetsReceived ?? 0;
              if (stat.roundTripTime != null) {
                roundTripTime = Math.round(stat.roundTripTime * 1000);
              }
            }

            if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
              if (roundTripTime === 0 && stat.currentRoundTripTime != null) {
                roundTripTime = Math.round(stat.currentRoundTripTime * 1000);
              }
            }
          }
        }

        // Resolve codec names
        const videoCodecInfo = codecs.get(videoCodecId);
        const audioCodecInfo = codecs.get(audioCodecId);
        const videoCodec = videoCodecInfo?.mimeType?.split('/')[1] ?? '';
        const audioCodec = audioCodecInfo?.mimeType?.split('/')[1] ?? '';
        if (audioCodecInfo?.clockRate) {
          audioSampleRate = audioCodecInfo.clockRate;
        }

        const prev = prevRef.current;
        let videoBitrate = 0;
        let audioBitrate = 0;
        let packetLoss = 0;

        if (prev) {
          const timeDelta = (Date.now() - prev.timestamp) / 1000;
          if (timeDelta > 0) {
            videoBitrate = Math.round(((videoBytes - prev.videoBytes) * 8) / timeDelta / 1000);
            audioBitrate = Math.round(((audioBytes - prev.audioBytes) * 8) / timeDelta / 1000);
          }

          if (direction === 'inbound') {
            const totalNewPackets = packetsReceived - prev.packetsReceived + (packetsLost - prev.packetsLost);
            if (totalNewPackets > 0) {
              packetLoss = Math.round(((packetsLost - prev.packetsLost) / totalNewPackets) * 100);
            }
          } else {
            // For outbound, packet loss comes from remote-inbound-rtp
            const totalNewPackets = packetsReceived - prev.packetsReceived + (packetsLost - prev.packetsLost);
            if (totalNewPackets > 0) {
              packetLoss = Math.round(((packetsLost - prev.packetsLost) / totalNewPackets) * 100);
            }
          }
        }

        prevRef.current = { videoBytes, audioBytes, packetsSent, packetsReceived, packetsLost, timestamp: Date.now() };

        setStats({
          videoBitrate: Math.max(0, videoBitrate),
          audioBitrate: Math.max(0, audioBitrate),
          packetLoss: Math.max(0, packetLoss),
          roundTripTime,
          resolution: resolution || '-',
          framerate,
          videoCodec: videoCodec || '-',
          hasAudio,
          audioCodec: audioCodec || '-',
          audioSampleRate,
          connectionState: pc.connectionState,
        });
      } catch {
        // connection may have closed
      }
    };

    poll();
    const id = setInterval(poll, intervalMs);
    return () => clearInterval(id);
  }, [pc, direction, intervalMs]);

  return stats;
}
