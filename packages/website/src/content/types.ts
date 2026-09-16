export type Lang = 'en' | 'es';

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
    /** Which platform the command on screen is for, once the page has worked it out. */
    mac: string;
    windows: string;
    /** The link out for anyone on neither of the two. */
    other: string;
    thatIsIt: string;
    note: string;
  };
  copy: { label: string; done: string };
  /**
   * The floating panel that repaints this page the way Settings ▸ Look repaints the app. The
   * thirteen accents keep the app's own names and are not translated: they are what the
   * setting is called in `settings.json`, and a swatch says which colour it is anyway.
   */
  look: {
    title: string;
    lead: string;
    accent: string;
    tone: string;
    tones: Record<'base' | 'vivid' | 'pastel', string>;
    background: string;
    backgrounds: Record<'black' | 'white', string>;
    borders: string;
    borderNames: Record<'single' | 'double', string>;
    corners: string;
    cornerNames: Record<'rounded' | 'square', string>;
    note: string;
  };
  tui: {
    /**
     * What the terminal is, for anything that cannot look at it. The words inside it are not
     * here and cannot be: the demo is exported from the application, which has no languages —
     * a Spanish visitor downloads the same English interface the page is showing them.
     */
    alt: string;
    /** The keys under the participants, which the story panes draw as well as the terminal. */
    keys: { cam: string; screen: string; select: string; vol: string };
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
    /** Sharing a file: the card the app draws, and the three rates the setting picks. */
    files: Story & {
      pane: { title: string; rows: PaneRow[]; caption: string };
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
