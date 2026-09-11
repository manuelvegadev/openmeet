export type Lang = 'en' | 'es';

/** One line of the demo conversation. The cast and the timings live in `demo.ts`. */
export interface TuiLine {
  time: string;
  kind: 'msg' | 'join' | 'screen' | 'mute';
  who: string;
}

export interface Story {
  eyebrow: string;
  title: string;
  paragraphs: string[];
  note?: string;
}

/** A labelled line inside a pane: `Channels   stereo  · mono · left · right`. */
export interface PaneRow {
  k: string;
  v: string;
  tone?: 'ok' | 'accent';
  note?: string;
}

export interface Faq {
  q: string;
  a: string;
}

/** Everything the page says, in one language. Structure is shared; only the strings differ. */
export interface Copy {
  lang: Lang;
  /** BCP 47 for `og:locale`. */
  locale: string;
  meta: {
    title: string;
    description: string;
    ogAlt: string;
    /** The one-line answer to "what is OpenMeet", for the structured data. */
    summary: string;
    features: string[];
  };
  nav: {
    docs: string;
    github: string;
    download: string;
    selfHost: string;
    /** This language's own name, shown as the link to it from the other pages. */
    switchLabel: string;
    switchTitle: string;
  };
  hero: {
    titlePlain: string;
    titleAccent: string;
    lead: string;
    /** The two install lines' labels. */
    mac: string;
    windows: string;
    thatIsIt: string;
    note: string;
  };
  copy: { label: string; done: string };
  tui: {
    title: string;
    leave: string;
    room: string;
    /** A `msg` line's text, keyed by its time in `TUI_SCRIPT`. */
    messages: Record<string, string>;
    /** What the other line kinds say, in place of a message. */
    events: Record<Exclude<TuiLine['kind'], 'msg'>, string>;
    keys: {
      mute: string;
      devices: string;
      share: string;
      stopCam: string;
      select: string;
      vol: string;
      cam: string;
      screen: string;
      chat: string;
    };
    placeholder: string;
  };
  pillars: { eyebrow: string; title: string; text: string }[];
  stories: {
    account: Story & {
      pane: { title: string; pickName: string; pickColour: string; colours: string[]; caption: string };
    };
    audio: Story & { pane: { title: string; rows: PaneRow[]; bars: PaneRow[]; caption: string } };
    video: Story & {
      pane: { title: string; legend: { tag: string; text: string }[]; opens: string; caption: string };
    };
    /** The install sizes themselves are measurements, and live in `demo.ts`. */
    perf: Story & { pane: { title: string; facts: string[]; caption: string } };
  };
  platforms: {
    eyebrow: string;
    title: string;
    head: [string, string, string];
    rows: { name: string; status: string; ok: boolean; features: string }[];
    roadmapEyebrow: string;
    roadmapTitle: string;
    roadmap: { when: string; what: string; now?: boolean }[];
  };
  selfHost: { eyebrow: string; title: string; text: string };
  stack: { eyebrow: string; title: string };
  faq: { eyebrow: string; title: string; items: Faq[] };
  footer: { madeBy: string; changelog: string; download: string };
}
