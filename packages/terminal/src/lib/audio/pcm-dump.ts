import { appendFile, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Diagnostic PCM recorder. With OPENMEET_DUMP_DIR set, AudioManager writes raw s16le
 * interleaved stereo files for each stage of the pipeline so a "sounds wrong" report can
 * be pinned to capture, transport or playback. Frames are buffered in memory and flushed
 * asynchronously once a second so the audio loop never waits on disk.
 */
export class PcmDump {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly path: string;

  constructor(dir: string, name: string) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, `${name}.s16le`);
    this.timer = setInterval(() => this.flush(), 1000);
  }

  static fromEnv(name: string): PcmDump | null {
    const dir = process.env.OPENMEET_DUMP_DIR;
    return dir ? new PcmDump(dir, name) : null;
  }

  write(samples: Int16Array): void {
    // Copy: the caller reuses its frame buffers.
    this.chunks.push(Buffer.from(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength)));
    this.bytes += samples.byteLength;
  }

  private flush(): void {
    if (this.chunks.length === 0) return;
    const data = Buffer.concat(this.chunks, this.bytes);
    this.chunks = [];
    this.bytes = 0;
    appendFile(this.path, data, () => {});
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }
}
