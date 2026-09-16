import { Fragment } from 'react';
import terminal from '../content/terminal.json';
import { useCopy } from '../lib/i18n';

/**
 * The terminal, exported from the application that draws it.
 *
 * Nothing here decides what the room looks like. `packages/go/internal/tui/export_test.go`
 * plays the app's own `--demo` against a canvas and writes `content/terminal.json`: the frame
 * once, then every part of it that moves, as cells with the **name** of the colour they were
 * drawn in. This component lays those cells out and the stylesheet says what `accent` and
 * `muted` are, which is how the Look panel still repaints the inside of the terminal.
 *
 * So there is no HTML copy of the room to keep in step any more, and a Go test fails if the
 * room is changed without regenerating this — the page cannot quietly go out of date.
 *
 * It costs nothing at runtime. React is a build-time template here: what ships is the cells
 * already laid out, with the timings as custom properties and the animation in CSS. About
 * three kilobytes over the wire for thirty-six seconds of a call.
 */

type Cell = [string, string?, string?, number?];
type Version = { from: number; to?: number; rows: Cell[][]; type?: number; caret?: number };
type Area = { x: number; y: number; w: number; h: number; v: Version[] };

type Terminal = {
  cols: number;
  rows: number;
  duration: number;
  chrome: Area;
  header: Area;
  people: Area;
  composer: Area;
  draft: Area;
  /** One list of versions per block of the conversation, in the order they are stacked. */
  log: Version[][];
  logRect: Area;
};

const T = terminal as unknown as Terminal;

/** Past the end of the script: what `to` means when a version is never replaced. */
const HOLD = 99999;

/** A cell's classes: the foreground, the background it paints, and bold. */
function classOf(cell: Cell): string {
  const out: string[] = [];
  if (cell[1]) out.push(`f-${cell[1]}`);
  if (cell[2]) out.push(`b-${cell[2]}`);
  if (cell[3]) out.push('bold');
  return out.join(' ');
}

/** One row's cells. A run in no style at all is written as itself, which is most of a frame. */
function Cells({ cells }: { cells: Cell[] }) {
  return (
    <>
      {cells.map((cell, i) => {
        const c = classOf(cell);
        return c ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a drawn frame, fixed when it was exported
          <span key={i} className={c}>
            {cell[0]}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a drawn frame, fixed when it was exported
          <Fragment key={i}>{cell[0]}</Fragment>
        );
      })}
    </>
  );
}

function Rows({ rows }: { rows: Cell[][] }) {
  return (
    <>
      {rows.map((cells, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a drawn frame, fixed when it was exported
        <div key={i} className="tt__r">
          <Cells cells={cells} />
        </div>
      ))}
    </>
  );
}

function when(v: Version): React.CSSProperties {
  return { '--f': `${v.from}s`, '--t': `${v.to || HOLD}s` } as React.CSSProperties;
}

function at(a: Area): React.CSSProperties {
  return { '--x': a.x, '--y': a.y, '--w': a.w, '--h': a.h } as React.CSSProperties;
}

/**
 * The composer while a message of yours is being written. The export carries the finished
 * line once and says how many cells it is; the reveal is a `steps()` clip over exactly as
 * long as the typing took, so the page holds one frame where a recording would hold seventy.
 *
 * The caret is the page's: the room blinks it off the model's clock, which is not something
 * to ship frames of, and on a line being typed it has to ride the reveal rather than wait at
 * the end of a message nobody has written yet.
 */
function Draft({ v }: { v: Version }) {
  const cells = v.rows[0] ?? [];
  const caret = { '--n': v.caret ?? 0 } as React.CSSProperties;
  if (!v.type) {
    return (
      <div className="tt__r">
        <Cells cells={cells} />
        <span className="tt__caret" style={caret} />
      </div>
    );
  }
  // How many steps it takes is how many characters it is, so the timing function cannot live
  // in the stylesheet: it is written into the element, at build time, once.
  const steps = `${(v.to ?? v.from) - v.from}s steps(${v.type}) ${v.from}s both`;
  return (
    <div className="tt__r">
      <span className="tt__typed" style={{ ...caret, animation: `tt-type ${steps}` }}>
        <Cells cells={cells} />
      </span>
      <span className="tt__caret" style={{ ...caret, animation: `tt-caret ${steps}` }} />
    </div>
  );
}

/**
 * One rectangle of the screen and every version of it. They are stacked on top of each other
 * and exactly one is shown at a time — the frame never changes, and the header, the
 * participants, the composer and the draft change a handful of times in thirty-six seconds.
 */
function Part({ area, draft }: { area: Area; draft?: boolean }) {
  return (
    <div className={draft ? 'tt__part tt__part--draft' : 'tt__part'} style={at(area)}>
      {area.v.map((v) => (
        <div key={v.from} className="tt__v" style={when(v)}>
          {draft ? <Draft v={v} /> : <Rows rows={v.rows} />}
        </div>
      ))}
    </div>
  );
}

/**
 * The conversation. Each block is a bubble, a file card or a room event — the app's own
 * division of the log (`bubbles.go`) — and they are stacked against the **bottom** of the
 * pane and clipped at the top, which is what the room does with them: the newest is at the
 * bottom and everything above it is pushed up.
 *
 * A block with more than one version is one that changed: a second message from the same
 * person joins the bubble above it and makes it taller, and a transfer moves its own bar.
 */
function Log() {
  return (
    <div className="tt__log" style={at(T.logRect)}>
      {T.log.map((versions, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positions in the log, in order
        <div key={i} className="tt__blk">
          {versions.map((v) => (
            <div key={v.from} className="tt__bv" style={{ ...when(v), '--n': v.rows.length } as React.CSSProperties}>
              <Rows rows={v.rows} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Tui() {
  const c = useCopy();
  return (
    <section className="wrap tui-section" aria-label={c.tui.alt}>
      <div className="tui-window">
        <div className="tui-window__bar">
          <i />
          <i />
          <i />
        </div>
        {/* One image as far as a screen reader is concerned — the cells underneath are a
            picture of a window, not a document — while the words in it stay in the HTML for
            anything that reads the page as text. */}
        <div
          className="tt"
          role="img"
          aria-label={c.tui.alt}
          style={{ '--cols': T.cols, '--rows': T.rows } as React.CSSProperties}
        >
          <Part area={T.chrome} />
          <Part area={T.header} />
          <Part area={T.people} />
          <Part area={T.composer} />
          <Part area={T.draft} draft />
          <Log />
        </div>
      </div>
    </section>
  );
}
