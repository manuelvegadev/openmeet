import type { Copy } from './types';

export const en: Copy = {
  lang: 'en',
  locale: 'en_US',
  meta: {
    title: 'OpenMeet — voice, screen and chat from the terminal, no account',
    description:
      'Open-source, peer-to-peer meetings from a terminal: Opus audio, screen and webcam sharing as hardware H.264, chat and file transfer. One 12 MB binary, no account, no browser, self-hostable. macOS and Windows.',
    ogAlt:
      'OpenMeet running in a terminal: the conversation on the left, the participants with their state tags on the right',
    summary:
      'OpenMeet is an open-source terminal app for audio calls, screen and webcam sharing, chat and file transfer, in one 12 MB binary. Media and files travel peer to peer over WebRTC; the server only relays the handshake. No account is needed and the server can be self-hosted.',
    features: [
      'Opus audio at 48 kHz with in-band FEC, encoded once for the whole room',
      'Screen sharing in the screen’s own aspect ratio, up to 1080 px tall at 30 fps',
      'Webcam sharing up to 720 px, on its own track beside the screen, both as hardware H.264',
      'Text chat with room events in one stream',
      'Peer-to-peer file transfer over a data channel, never through the server',
      'Per-peer volume, speaking indicators and latency estimates',
      'No account: a name and a colour, chosen once',
      'Peer-to-peer WebRTC mesh, up to six participants',
      'Self-hostable signaling server with no database',
      'Keeps itself up to date from GitHub Releases',
    ],
  },
  nav: {
    docs: 'Docs',
    github: 'GitHub',
    download: 'Download',
    selfHost: 'Self-host',
    switchLabel: 'English',
    switchTitle: 'Read this page in English',
  },
  hero: {
    titlePlain: 'No account. No browser. Just a terminal, a room ',
    titleAccent: 'and your voice.',
    lead: 'Opus calls, screen and webcam sharing, chat and files, peer to peer, from a terminal. Open source, self-hostable, one 12 MB binary, and light enough to forget it is running.',
    mac: 'macOS detected',
    windows: 'Windows detected',
    other: 'Other platforms',
    thatIsIt: 'that is the whole setup',
    note: 'Nothing else to install. ffmpeg only if you want to share a screen or a camera.',
  },
  copy: { label: 'copy', done: 'copied' },
  look: {
    title: 'Look',
    lead: 'The app\u2019s own Look settings, on this page.',
    accent: 'Accent',
    tone: 'Tone',
    tones: { base: 'base', vivid: 'vivid', pastel: 'pastel' },
    background: 'Background',
    backgrounds: { black: 'black', white: 'white' },
    borders: 'Borders',
    borderNames: { single: 'single', double: 'double' },
    corners: 'Corners',
    cornerNames: { rounded: 'rounded', square: 'square' },
    note: 'Kept in this browser. The app has the same five, plus a transparent background.',
  },
  tui: {
    alt: 'OpenMeet running in a terminal: a call with two other people, the conversation on the left and the participants on the right.',
    keys: { cam: 'cam', screen: 'screen', select: 'select', vol: 'vol' },
  },
  pillars: [
    {
      eyebrow: '01 · Privacy',
      title: 'Your audio never touches our server.',
      text: 'Media goes peer to peer over WebRTC. The server only passes the handshake, keeps rooms in memory and forgets them when the last person leaves. No accounts, no database, nothing to leak.',
    },
    {
      eyebrow: '02 · Open source',
      title: 'MIT, on GitHub, all of it.',
      text: 'The client, the signaling server and the shared protocol live in one repository. Read how the audio path works, run the benchmarks yourself, or host the server on your own box with one compose file.',
    },
    {
      eyebrow: '03 · Performance',
      title: 'One binary, not a browser tab.',
      text: 'The audio callbacks run in C, straight against CoreAudio and WASAPI, and the microphone is encoded once for the whole room. No Electron, no Chromium, no runtime to install, no web page pretending to be an app.',
    },
    {
      eyebrow: '04 · The interface',
      title: 'A terminal app you can click.',
      text: 'Messages are bubbles, files are cards, and the mouse works: click a key, scroll a pane, drag across the conversation to select and copy it. Colours, tone, background and borders are yours — the panel in the corner of this page is the same five settings.',
    },
  ],
  stories: {
    account: {
      eyebrow: 'Plug and play',
      title: 'Nothing to sign up for.',
      paragraphs: [
        'The first start asks for a name of up to eight characters and a colour. That is your identity: everyone sees you as [mvega], in your colour, in the list and in every message.',
        'Rooms are just names. Type one nobody is in and it exists; leave and it is gone. No links to generate, no waiting room, no calendar.',
      ],
      note: 'Up to six people per room, each connected directly to the others.',
      pane: {
        title: 'first start · who are you',
        pickName: 'Pick a name',
        pickColour: 'Pick a colour',
        colours: ['white', 'red', 'yellow', 'green', 'blue', 'purple'],
        caption: 'Two questions, once. Then you are in.',
      },
    },
    audio: {
      eyebrow: 'Audio',
      title: 'Built for voices.',
      paragraphs: [
        'Opus at 48 kHz, encoded once and sent to everyone in the room, with in-band FEC so a lost packet is not a lost syllable. A voice gate keeps the line silent while you are, which is most of a call.',
        'Devices open at their native rate and follow the system when it changes one: Bluetooth headphones that switch profile mid-call are reopened, not left robotic. On macOS, Apple’s own Voice Isolation and echo cancellation are on by default; Wave Link and NVIDIA Broadcast are recognised and offered first.',
      ],
      note: 'Per-peer volume, a speaking dot and a latency estimate next to every name.',
      pane: {
        title: 'settings · audio',
        rows: [
          {
            k: 'Codec',
            v: 'Opus 48 kHz',
            tone: 'ok',
            note: '· 128 kbps by default, a setting; one encoder for the room',
          },
          { k: 'Loss', v: 'in-band FEC', tone: 'ok', note: '+ concealment — a lost packet is not a lost syllable' },
          { k: 'Voice gate', v: 'on', tone: 'ok', note: '— silence costs nothing' },
          { k: 'Processing', v: 'Apple', tone: 'ok', note: '(Voice Isolation, echo cancellation) · off' },
        ],
        bars: [
          { k: 'Sample rate', v: '48 kHz' },
          { k: 'Frame', v: '20 ms' },
          { k: 'Encoders', v: '1 per room' },
        ],
        caption: 'Every value is a setting or a flag:',
      },
    },
    video: {
      eyebrow: 'Screen and camera',
      title: 'Share a screen. Or a camera. Both.',
      paragraphs: [
        'Screen share keeps the screen’s own shape, up to 1080 px tall and 30 fps: an ultrawide goes out as 2580×1080, not letterboxed. The webcam goes out at up to 720 px in the camera’s own aspect ratio.',
        'Both travel on their own WebRTC tracks as H.264 from the GPU’s encoder — VideoToolbox on the Mac, NVENC on Windows — encoded once and sent to everyone, so a share does not interrupt the camera or the audio, and the bitrate follows the size of the room.',
      ],
      note: 'Webcam is macOS for now. Windows gets it before 1.0.',
      pane: {
        title: 'room · participants',
        legend: [
          { tag: 'S', text: 'is sharing a screen ·' },
          { tag: 'C', text: 'has the camera on ·' },
          { tag: 'm', text: 'is muted' },
        ],
        opens: 'opens it',
        caption: 'Video opens in its own window, at the sender’s resolution.',
      },
    },
    files: {
      eyebrow: 'Files',
      title: 'Send a file without sending it anywhere.',
      paragraphs: [
        'Drag a file onto the composer, or press ctrl+v to attach whatever is on the clipboard — a file copied in the Finder, or an image, which is how a screenshot gets shared. The room sees a card with its name, its size and its SHA-256.',
        'Nothing is pushed and nothing is uploaded. The description travels over the signaling connection; the file itself moves only when somebody asks for it, over a data channel on the peer connection you already have. The server never holds one, never sees one, and keeps no record that one existed.',
      ],
      note: 'Arrives in ~/Downloads/openmeet, written to .part until the digest checks out.',
      pane: {
        title: 'settings · file transfer',
        rows: [
          {
            k: 'voice first',
            v: 'default',
            tone: 'ok',
            note: '— takes what is spare, gives it back when the call suffers',
          },
          { k: 'unlimited', v: 'as fast as it goes', note: '— never gives it back' },
          { k: 'capped', v: '2 Mbps', note: '— a flat ceiling' },
        ],
        caption:
          'A transfer and the voice ride one socket, so no network priority mark can tell them apart. Watching the call\u2019s round trip is the only thing that can:',
      },
    },
    perf: {
      eyebrow: 'Performance',
      title: 'No browser in the loop.',
      paragraphs: [
        'One process, one binary. The audio callbacks stay in C and a single Opus encoder feeds every peer, so a call costs the same with two people as with six: about 4% of one core and 35 MB with the interface included, and the interface itself draws only the cells that changed.',
        'Nothing here ships a browser. Opus runs native, video is encoded on the GPU, the terminal draws text, and the whole client is a 12 MB binary — against 479 MB for Discord’s app and 1.4 GB for Chrome’s, before either has opened a window.',
      ],
      pane: {
        title: 'installed, on one Mac',
        facts: [
          'one process: interface, audio and network',
          'in a call: ~4% of a core, 35 MB, whatever the room size',
          'no Electron, no Chromium, no runtime to install',
          'a screen share: hardware H.264, 1.3% of a core in the app',
        ],
        caption:
          'Measured, not estimated: Apple M4 Pro, macOS 15, against Discord 0.0.411 and Chrome 152 as they ship.',
      },
    },
  },
  platforms: {
    eyebrow: 'Platforms',
    title: 'macOS and Windows, today.',
    head: ['Platform', 'Status', 'What works'],
    rows: [
      {
        name: 'macOS 15 or later',
        status: 'Supported',
        ok: true,
        features: 'Audio, chat, files, webcam, screen share',
      },
      { name: 'Windows 11', status: 'Supported', ok: true, features: 'Audio, chat, files, screen share' },
      { name: 'Linux', status: 'Limited', ok: false, features: 'Runs, best effort, not tested' },
    ],
    roadmapEyebrow: 'Roadmap',
    roadmapTitle: 'What comes next.',
    roadmap: [
      { when: 'v1.0', what: 'macOS and Windows at feature parity', now: true },
      { when: 'next', what: 'Ubuntu and Fedora, supported' },
      { when: 'then', what: 'a web client, for the person without a terminal' },
      { when: 'later', what: 'Android' },
    ],
  },
  selfHost: {
    eyebrow: 'Self-host',
    title: 'Or run the server yourself.',
    text: 'The public server is the default. The signaling server is an Express app with no database, so yours is one compose file away.',
  },
  stack: { eyebrow: 'Built with', title: 'Nothing exotic.' },
  faq: {
    eyebrow: 'Questions',
    title: 'Before you install.',
    items: [
      {
        q: 'Where does my audio go?',
        a: 'To the other people in the room, directly, over WebRTC. The server never sees media, only the signaling handshake, and it keeps nothing once the room is empty.',
      },
      {
        q: 'Do I need an account?',
        a: 'No. The first start asks for a name and a colour, once. Rooms are names: type one and it exists.',
      },
      {
        q: 'Do I need ffmpeg?',
        a: 'Only to share a screen or a camera. The binary talks to CoreAudio and WASAPI itself, so a call needs nothing else.',
      },
      {
        q: 'Can I send a file?',
        a: 'Yes, and it never goes through the server. Drag it onto the composer or press ctrl+v to attach what is on the clipboard; the room sees a card, and the file itself moves only when somebody asks for it, over a data channel on the connection you already have with that person. It lands in ~/Downloads/openmeet once its SHA-256 checks out.',
      },
      {
        q: 'How do I update it?',
        a: 'You do not. The client asks GitHub Releases on every start, downloads the new binary beside itself, checks it runs, and swaps it in when you quit. You can set it to ask first, or not to look at all.',
      },
      {
        q: 'Is it free?',
        a: 'Yes. MIT licence, public server included. Host your own if you would rather not trust ours.',
      },
      {
        q: 'Which platforms are supported?',
        a: 'macOS 15 or later and Windows 11 on real hardware. Linux runs as best effort and is not actively tested. Ubuntu and Fedora support, a web client and Android are on the roadmap.',
      },
      {
        q: 'How good is the audio?',
        a: 'Opus at 48 kHz with in-band FEC and concealment against packet loss, a voice gate so silence costs nothing, and on macOS Apple’s Voice Isolation and echo cancellation by default. The bitrate is a flag.',
      },
    ],
  },
  footer: { madeBy: 'made by', changelog: 'Changelog', download: 'Download' },
};
