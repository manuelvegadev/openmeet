import { PEERS, TUI_SCRIPT, YOU } from '../content/demo';
import type { TuiLine } from '../content/types';
import { useCopy } from '../lib/i18n';
import { APP_VERSION } from '../lib/site';
import { Key, Name, Peer, PeerKeys } from './ui';

const ICON: Record<TuiLine['kind'], string> = { msg: '›', join: '+', screen: '▣', mute: '♪' };

function Line({ line, index }: { line: TuiLine; index: number }) {
  const c = useCopy();
  return (
    <div className="tui__ln" style={{ '--i': index } as React.CSSProperties}>
      <span className="muted">[{line.time}]</span>{' '}
      <span className={`tui__icon tui__icon--${line.kind}`}>{ICON[line.kind]}</span> <Name who={line.who} />{' '}
      {line.kind === 'msg' ? c.tui.messages[line.time] : <span className="muted">{c.tui.events[line.kind]}</span>}
    </div>
  );
}

/**
 * The room as docs/screenshot.png shows it, drawn in HTML: a macOS window, the gold frame with
 * the header rule, the chat on the left with its composer as the pane's last row, the
 * participants on the right with your row and keys, the section rule, the peers, and their
 * keys pinned at the foot. The chat lines appear one by one on load. HTML rather than a
 * recording because it is crisp at any size and weighs nothing.
 */
export function Tui() {
  const c = useCopy();
  return (
    <section className="wrap tui-section" aria-label="OpenMeet in a terminal">
      <div className="tui-window">
        <div className="tui-window__bar">
          <i />
          <i />
          <i />
        </div>
        <div className="tui tui--reveal">
          <div className="tui__head">
            <span className="accent">
              <b>OpenMeet</b>
            </span>
            <span className="muted">v{APP_VERSION} (macOS)</span>
            <Key k="q" label={c.tui.leave} />
            <span>│</span>
            <span>
              {c.tui.room}: <b>standup</b>
            </span>
            <span>│</span>
            <span>4p</span>
            <span className="tui__elapsed">
              │ <span className="muted">23m</span>
            </span>
            <span className="grow" />
            <span className="tui__stats">
              <span className="info">↑128k ↓384k</span> │ RTT:18ms Loss:0% │
            </span>
            <span className="ok">●</span>
          </div>
          <div className="tui__body">
            <div className="tui__chat">
              <div className="tui__log">
                {TUI_SCRIPT.map((line, i) => (
                  <Line key={line.time} line={line} index={i} />
                ))}
              </div>
              <div className="tui__input">
                <span className="muted">&gt; {c.tui.placeholder}</span>
                <span className="grow" />
                <Key k="tab" label={c.tui.keys.chat} />
              </div>
            </div>
            <div className="tui__people">
              <Peer peer={YOU} />
              <div className="tui__keys">
                <Key k="m" label={c.tui.keys.mute} />
                <Key k="d" label={c.tui.keys.devices} />
                <Key k="s" label={c.tui.keys.share} />
                <Key k="v" label={c.tui.keys.stopCam} />
              </div>
              <div className="tui__rule" />
              {PEERS.map((peer) => (
                <Peer key={peer.who} peer={peer} />
              ))}
              <div className="grow" />
              <PeerKeys camDisabled />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
