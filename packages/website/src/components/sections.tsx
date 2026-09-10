import { AUDIO_KBPS_STEPS, INSTALL_SIZES, PEERS, STACK } from '../content/demo';
import type { Lang, PaneRow, Story } from '../content/types';
import { useCopy } from '../lib/i18n';
import { SELF_HOST_CMDS } from '../lib/site';
import { Chip, Eyebrow, Key, Peer, PeerKeys, WithNames } from './ui';

export function Pillars() {
  const c = useCopy();
  return (
    <section className="wrap pillars" aria-label="Why">
      {c.pillars.map((p) => (
        <div key={p.eyebrow} className="pillar">
          <Eyebrow>{p.eyebrow}</Eyebrow>
          <h2 className="display pillar__title">{p.title}</h2>
          <p>{p.text}</p>
        </div>
      ))}
    </section>
  );
}

function Prose({ story }: { story: Story }) {
  return (
    <div className="story__prose">
      <Eyebrow>{story.eyebrow}</Eyebrow>
      <h2 className="display story__title">{story.title}</h2>
      {story.paragraphs.map((p) => (
        <p key={p}>
          <WithNames text={p} />
        </p>
      ))}
      {story.note ? <p className="muted story__note">{story.note}</p> : null}
    </div>
  );
}

function Pane({ title, caption, children }: { title: string; caption: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="pane">
      <div className="pane__title">{title}</div>
      <div className="pane__body">{children}</div>
      <div className="pane__caption">{caption}</div>
    </div>
  );
}

function Bar({ label, value, width, dim }: { label: string; value: string; width: string; dim?: boolean }) {
  return (
    <div className="bar">
      <span className="bar__label">{label}</span>
      <span className="bar__track">
        <i style={{ width, background: dim ? 'var(--line-strong)' : 'var(--accent)' }} />
      </span>
      <span className={dim ? 'bar__value' : 'bar__value accent'}>{value}</span>
    </div>
  );
}

/** A settings line. An empty `v` means the row is the Opus ladder, which is data, not copy. */
function SettingRow({ row }: { row: PaneRow }) {
  return (
    <div className="ln">
      <span className="muted pane__k">{row.k}</span>{' '}
      {row.v ? <span className={row.tone ?? 'muted'}>{row.v}</span> : <Ladder />}{' '}
      {row.note ? <span className="muted">{row.note}</span> : null}
    </div>
  );
}

/** `64 · 96 · 128 · 192 · [256 kbps]` — the last step is the one the page claims. */
function Ladder() {
  const chosen = AUDIO_KBPS_STEPS.at(-1);
  return (
    <>
      <span className="muted">{AUDIO_KBPS_STEPS.slice(0, -1).join(' · ')} ·</span>{' '}
      <span className="accent">[{chosen} kbps]</span>
    </>
  );
}

/** `78 MB`, `1.4 GB` — one measurement, written the way the reader's language writes numbers. */
function formatSize(mb: number, lang: Lang): string {
  if (mb < 1024) return `${mb} MB`;
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(mb / 1024)} GB`;
}

const COLOURS = ['--text', '--danger', '--yellow', '--ok', '--blue', '--purple'];
const WIDEST_INSTALL = Math.max(...INSTALL_SIZES.map((r) => r.mb));

export function Stories() {
  const c = useCopy();
  const { account, audio, video, perf } = c.stories;
  return (
    <div className="wrap">
      <section className="story" id="no-account">
        <Pane title={account.pane.title} caption={account.pane.caption}>
          <div className="accent pane__label">{account.pane.pickName}</div>
          <div className="cmd cmd--input">
            <span>mvega</span>
            <span className="cursor" />
          </div>
          <div className="accent pane__label">{account.pane.pickColour}</div>
          {account.pane.colours.map((name, i) => (
            <div key={name} className="ln">
              <span className={i === 2 ? 'accent' : 'muted'}>{i === 2 ? '▸ ' : '  '}</span>
              <span style={{ color: `var(${COLOURS[i]})` }}>[mvega]</span> <span className="muted">{name}</span>
            </div>
          ))}
        </Pane>
        <Prose story={account} />
      </section>

      <section className="story" id="audio">
        <Pane
          title={audio.pane.title}
          caption={
            <>
              {audio.pane.caption} <span className="accent">--audio-send-kbps {AUDIO_KBPS_STEPS.at(-1)}</span>
            </>
          }
        >
          {audio.pane.rows.map((row) => (
            <SettingRow key={row.k} row={row} />
          ))}
          <div className="pane__bars">
            {audio.pane.bars.map((bar, i) => (
              <Bar key={bar.k} label={bar.k} value={bar.v} width={i === 1 ? '12%' : '100%'} />
            ))}
          </div>
        </Pane>
        <Prose story={audio} />
      </section>

      <section className="story" id="screen-and-camera">
        <Pane title={video.pane.title} caption={video.pane.caption}>
          {PEERS.map((peer) => (
            <Peer key={peer.who} peer={peer} rate={false} />
          ))}
          <div className="pane__keys">
            <PeerKeys />
          </div>
          <div className="legend muted">
            {video.pane.legend.map((entry) => (
              <LegendLine key={entry.tag} tag={entry.tag} text={entry.text} opens={video.pane.opens} />
            ))}
          </div>
        </Pane>
        <Prose story={video} />
      </section>

      <section className="story" id="performance">
        <Pane title={perf.pane.title} caption={perf.pane.caption}>
          {INSTALL_SIZES.map((row) => (
            <Bar
              key={row.label}
              label={row.label}
              value={formatSize(row.mb, c.lang)}
              width={`${Math.max(3, (row.mb / WIDEST_INSTALL) * 100)}%`}
              dim={!row.us}
            />
          ))}
          <div className="pane__facts muted">
            {perf.pane.facts.map((f) => (
              <div key={f}>{f}</div>
            ))}
          </div>
        </Pane>
        <Prose story={perf} />
      </section>
    </div>
  );
}

/** One legend line: the tag, what it means, and the key that opens that window where there is one. */
function LegendLine({ tag, text, opens }: { tag: string; text: string; opens: string }) {
  const key = tag === 'S' ? 'e' : tag === 'C' ? 'w' : null;
  return (
    <>
      <span className={`tag tag--${tag.toLowerCase()}`}>{tag}</span>
      <span>
        {text} {key ? <Key k={key} label={opens} /> : null}
      </span>
    </>
  );
}

export function Platforms() {
  const c = useCopy();
  return (
    <section className="band" id="platforms">
      <div className="wrap two-col">
        <div>
          <Eyebrow>{c.platforms.eyebrow}</Eyebrow>
          <h2 className="display section__title">{c.platforms.title}</h2>
          <table>
            <thead>
              <tr>
                {c.platforms.head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.platforms.rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className={r.ok ? 'ok' : 'warn'}>{r.status}</td>
                  <td>{r.features}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <Eyebrow>{c.platforms.roadmapEyebrow}</Eyebrow>
          <h2 className="display section__title">{c.platforms.roadmapTitle}</h2>
          <ol className="roadmap">
            {c.platforms.roadmap.map((r) => (
              <li key={r.when}>
                <span className={r.now ? 'accent' : 'muted'}>{r.now ? '●' : '○'}</span>
                <span className={r.now ? 'accent' : undefined}>{r.when}</span>
                <span className="muted">{r.what}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function SelfHostAndStack() {
  const c = useCopy();
  return (
    <section className="band" id="self-host">
      <div className="wrap two-col">
        <div>
          <Eyebrow>{c.selfHost.eyebrow}</Eyebrow>
          <h2 className="display section__title">{c.selfHost.title}</h2>
          <p className="section__text">{c.selfHost.text}</p>
          <div className="cmd cmd--block">
            {SELF_HOST_CMDS.map((cmd) => (
              <div key={cmd}>
                <span className="cmd__dollar">$</span> <code>{cmd}</code>
              </div>
            ))}
          </div>
        </div>
        <div>
          <Eyebrow>{c.stack.eyebrow}</Eyebrow>
          <h2 className="display section__title">{c.stack.title}</h2>
          <div className="chips">
            {STACK.map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  const c = useCopy();
  return (
    <section className="band" id="faq">
      <div className="wrap">
        <Eyebrow>{c.faq.eyebrow}</Eyebrow>
        <h2 className="display section__title">{c.faq.title}</h2>
        <dl className="faq">
          {c.faq.items.map((item) => (
            <div key={item.q} className="faq__item">
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
