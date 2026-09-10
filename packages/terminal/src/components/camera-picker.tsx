import { useEffect, useRef, useState } from 'react';
import { rawVideoPlayerArgs, WEBCAM_FPS, WEBCAM_HEIGHT, WEBCAM_WIDTH, webcamCaptureArgs } from '../lib/capture-args.js';
import type { VideoDevice } from '../lib/devices.js';
import { startPreview } from '../lib/preview.js';
import { theme } from '../lib/theme.js';
import { Modal } from './modal.js';
import { Select } from './select.js';
import { Text } from './text.js';

interface CameraPickerProps {
  cameras: VideoDevice[];
  /** The one to start on, if it is still there. */
  current?: string | null;
  /**
   * The room still has the camera open. A preview cannot have it at the same time (macOS
   * opens a camera once), so `t` waits for the grabber to exit rather than failing with
   * `Input/output error` — which is what it did before this flag existed.
   */
  cameraBusy?: boolean;
  /** Chosen: the room points the capture at it and turns the camera on. */
  onSelect: (device: VideoDevice) => void;
  onCancel: () => void;
}

/**
 * Which camera to share, over the room, the way screens are chosen — with `t` to look through
 * one first, since a list of names says little about which lens is which.
 *
 * The room releases the capture before this opens: on macOS a camera opens once, so a preview
 * and a capture cannot both hold it. Only one preview runs at a time, and it is closed on the
 * way out however you leave.
 */
/**
 * What to tell someone whose preview showed nothing. macOS says `Input/output error` for the
 * common case by far — another app already has the camera, since most cameras open once — and
 * that message sends people looking for a fault that is not there.
 */
function explain(closedBy: 'capture' | 'player', error?: string): string {
  if (closedBy === 'capture' && error && /input\/output error/i.test(error)) {
    return 'Another app has this camera (OBS, Zoom, a browser tab…). Close it and try again.';
  }
  if (error) return error;
  return closedBy === 'player' ? 'The preview window closed without a picture.' : 'The camera sent no picture.';
}

export function CameraPicker({ cameras, current, cameraBusy = false, onSelect, onCancel }: CameraPickerProps) {
  const [highlighted, setHighlighted] = useState<VideoDevice>(cameras.find((c) => c.id === current) ?? cameras[0]);
  const [previewing, setPreviewing] = useState<string | null>(null);
  /** Why the last preview showed nothing, if it did not: what ffmpeg or ffplay actually said. */
  const [failure, setFailure] = useState<{ id: string; reason: string } | null>(null);
  const stopPreview = useRef<(() => void) | null>(null);

  const close = () => {
    stopPreview.current?.();
    stopPreview.current = null;
    setPreviewing(null);
  };

  // Whatever ends the picker — a choice, Escape, the room going away — takes the window with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount only; `close` reads refs
  useEffect(() => close, []);

  const preview = (device: VideoDevice) => {
    close();
    const args = webcamCaptureArgs(device.id);
    if (!args) return;
    setPreviewing(device.id);
    setFailure(null);
    stopPreview.current = startPreview(
      args,
      rawVideoPlayerArgs(WEBCAM_WIDTH, WEBCAM_HEIGHT, WEBCAM_FPS, `Preview: ${device.name}`),
      ({ sawFrames, closedBy, error }) => {
        stopPreview.current = null;
        setPreviewing(null);
        // Closing the window is how a preview is meant to end; anything else with no picture
        // is a failure, and the message says which side failed and what it said.
        if (sawFrames) return;
        setFailure({ id: device.id, reason: explain(closedBy, error) });
      },
    );
  };

  const items = cameras.map((c) => ({
    label: `${c.name}${previewing === c.id ? ' · previewing' : ''}`,
    value: c.id,
  }));
  const initialIndex = Math.max(
    0,
    cameras.findIndex((c) => c.id === highlighted?.id),
  );

  return (
    <Modal
      title="Share a camera"
      hints={[
        { key: 't', label: previewing ? 'close preview' : 'try it', disabled: cameraBusy },
        { key: 'enter', label: 'share' },
        { key: 'esc', label: 'cancel' },
      ]}
      onKey={(input, key) => {
        if (key.escape) {
          close();
          onCancel();
          return;
        }
        if (input === 't' && highlighted && !cameraBusy) {
          if (previewing === highlighted.id) close();
          else preview(highlighted);
        }
      }}
    >
      <Select
        items={items}
        initialIndex={initialIndex}
        onHighlight={(item) => {
          const device = cameras.find((c) => c.id === item.value);
          if (device) setHighlighted(device);
        }}
        onSelect={(item) => {
          const device = cameras.find((c) => c.id === item.value);
          if (!device) return;
          close();
          onSelect(device);
        }}
      />
      {cameraBusy ? (
        <Text dimColor>Letting go of the camera…</Text>
      ) : failure ? (
        <Text color={theme.danger}>{failure.reason}</Text>
      ) : (
        <Text dimColor>The camera turns on when you pick one.</Text>
      )}
    </Modal>
  );
}
