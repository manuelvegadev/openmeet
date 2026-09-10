import { useEffect, useRef, useState } from 'react';
import { rawVideoPlayerArgs, WEBCAM_FPS, WEBCAM_HEIGHT, WEBCAM_WIDTH, webcamCaptureArgs } from '../lib/capture-args.js';
import type { VideoDevice } from '../lib/devices.js';
import { startPreview } from '../lib/preview.js';
import { Modal } from './modal.js';
import { Select } from './select.js';
import { Text } from './text.js';

interface CameraPickerProps {
  cameras: VideoDevice[];
  /** The one to start on, if it is still there. */
  current?: string | null;
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
export function CameraPicker({ cameras, current, onSelect, onCancel }: CameraPickerProps) {
  const [highlighted, setHighlighted] = useState<VideoDevice>(cameras.find((c) => c.id === current) ?? cameras[0]);
  const [previewing, setPreviewing] = useState<string | null>(null);
  /** A camera that opened but sent nothing: a capture card with no signal answers that way. */
  const [silent, setSilent] = useState<string | null>(null);
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
    setSilent(null);
    stopPreview.current = startPreview(
      args,
      rawVideoPlayerArgs(WEBCAM_WIDTH, WEBCAM_HEIGHT, WEBCAM_FPS, `Preview: ${device.name}`),
      (sawFrames) => {
        stopPreview.current = null;
        setPreviewing(null);
        // The window closing is how you end a preview, so only silence is worth reporting.
        if (!sawFrames) setSilent(device.id);
      },
    );
  };

  const mark = (c: VideoDevice) =>
    previewing === c.id ? ' · previewing' : silent === c.id ? ' · sent no picture' : '';
  const items = cameras.map((c) => ({ label: `${c.name}${mark(c)}`, value: c.id }));
  const initialIndex = Math.max(
    0,
    cameras.findIndex((c) => c.id === highlighted?.id),
  );

  return (
    <Modal
      title="Share a camera"
      hints={[
        { key: 't', label: previewing ? 'close preview' : 'try it' },
        { key: 'enter', label: 'share' },
        { key: 'esc', label: 'cancel' },
      ]}
      onKey={(input, key) => {
        if (key.escape) {
          close();
          onCancel();
          return;
        }
        if (input === 't' && highlighted) {
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
      <Text dimColor>The camera turns on when you pick one.</Text>
    </Modal>
  );
}
