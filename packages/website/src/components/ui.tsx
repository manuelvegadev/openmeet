import type { PeerRow } from '../content/demo';
import { useCopy } from '../lib/i18n';

/**
 * A key on a gold keycap, followed by what it does on a grey pill, as the app draws them.
 * `disabled` is the app's greyed key: both halves on the surface grey, for a key that would do
 * nothing right now (the screenshot's `w cam`, with a peer selected who has no camera on).
 */
export function Key({ k, label, disabled }: { k: string; label: string; disabled?: boolean }) {
  return (
    <span className={disabled ? 'key key--disabled' : 'key'}>
      <kbd>{k}</kbd>
      <span className="pill">{label}</span>
    </span>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return <span className="chip">{children}</span>;
}

/**
 * A participant's name the one way the app shows it: `[name]`, brackets included, in their
 * colour. The four demo people have fixed colours (see _ui.scss).
 */
export function Name({ who }: { who: string }) {
  return (
    <span className="name" data-who={who}>
      [{who}]
    </span>
  );
}

const NAME_SPLIT = /(\[[a-z]+\])/;
const NAME_TOKEN = /^\[([a-z]+)\]$/;

/** Text with `[name]` tokens drawn as coloured names. */
export function WithNames({ text }: { text: string }) {
  return (
    <>
      {text.split(NAME_SPLIT).map((part, i) => {
        const m = part.match(NAME_TOKEN);
        // biome-ignore lint/suspicious/noArrayIndexKey: static text, never reordered
        return m ? <Name key={i} who={m[1] ?? ''} /> : <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** The app's ladder: dim up to 80 ms, orange to 150, red past it. */
function latencyTone(ms: number): string {
  if (ms <= 80) return 'muted';
  return ms <= 150 ? 'warn' : 'danger';
}

/**
 * One line of the participants column, the shape every row on the page shares: speaking dot,
 * selection marker, name and state tag on the left, numbers on the right. The dot is the
 * whole of the audio display — a meter redrawn ten times a second costs a full repaint each
 * time, which is why the app has one only where you are choosing a microphone.
 * `rate` and `latencyMs` are dropped where the pane has no room for them.
 */
export function Peer({ peer, rate = true, latency = true }: { peer: PeerRow; rate?: boolean; latency?: boolean }) {
  return (
    <div className="prow">
      <span className={peer.speaking ? 'ok' : 'muted'}>{peer.speaking ? '●' : '○'}</span>
      <span className="accent">{peer.selected ? '▸' : ' '}</span>
      <Name who={peer.who} />
      {peer.tag ? <span className={`tag tag--${peer.tag.toLowerCase()}`}>{peer.tag}</span> : null}
      <span className="grow" />
      {rate && peer.rate ? <span className="info">{peer.rate}</span> : null}
      {latency && peer.latencyMs ? <span className={latencyTone(peer.latencyMs)}>~{peer.latencyMs}ms</span> : null}
      {peer.volume ? <span className="muted">{peer.volume}</span> : null}
    </div>
  );
}

/** The keys pinned under the participants list. `w` greys out when the peer has no camera on. */
export function PeerKeys({ camDisabled }: { camDisabled?: boolean }) {
  const c = useCopy();
  return (
    <div className="tui__keys">
      <Key k="↑↓" label={c.tui.keys.select} />
      <Key k="-/+" label={c.tui.keys.vol} />
      <Key k="w" label={c.tui.keys.cam} disabled={camDisabled} />
      <Key k="e" label={c.tui.keys.screen} />
    </div>
  );
}

/**
 * Copies `data-copy` to the clipboard and shows `data-done` for a moment. Markup only: the
 * behaviour is `lib/copy.ts`, which runs identically on the dev server and on the published
 * page, so there is no second implementation to drift.
 */
export function CopyButton({ text }: { text: string }) {
  const c = useCopy();
  return (
    <button type="button" className="copy" data-copy={text} data-done={c.copy.done} aria-live="polite">
      {c.copy.label}
    </button>
  );
}

/** A shell line: `$` then the command, with a copy button on the right. */
/** `prompt` is `$` for a shell and `>` for PowerShell, where `$` would read as a variable. */
export function Cmd({
  cmd,
  note,
  copy = true,
  prompt = '$',
  os,
}: {
  cmd: string;
  note?: string;
  copy?: boolean;
  prompt?: string;
  /** Shown only on that platform, when the block around it says which one this is. */
  os?: 'mac' | 'win';
}) {
  return (
    <div className="cmd" data-for={os}>
      <span className="cmd__dollar">{prompt}</span>
      <code>{cmd}</code>
      {note ? <span className="cmd__note">{note}</span> : null}
      {copy ? <CopyButton text={cmd} /> : null}
    </div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}
