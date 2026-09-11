import type { Copy } from './types';

export const en: Copy = {
  lang: 'en',
  locale: 'en_US',
  meta: {
    title: 'OpenMeet — voice, screen and chat from the terminal, no account',
    description:
      'Open-source, peer-to-peer meetings from a terminal: Opus audio, screen and webcam sharing as hardware H.264, chat. One 12 MB binary, no account, no browser, self-hostable. macOS and Windows.',
    ogAlt:
      'OpenMeet running in a terminal: the conversation on the left, the participants with their state tags on the right',
    summary:
      'OpenMeet is an open-source terminal app for audio calls, screen and webcam sharing and chat, in one 12 MB binary. Media travels peer to peer over WebRTC; the server only relays the handshake. No account is needed and the server can be self-hosted.',
    features: [
      'Opus audio at 48 kHz with in-band FEC, encoded once for the whole room',
      'Screen sharing in the screen’s own aspect ratio, up to 1080 px tall at 30 fps',
      'Webcam sharing up to 720 px, on its own track beside the screen, both as hardware H.264',
      'Text chat with room events in one stream',
      'Per-peer volume, speaking indicators and latency estimates',
      'No account: a name and a colour, chosen once',
      'Peer-to-peer WebRTC mesh, up to six participants',
      'Self-hostable signaling server with no database',
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
    lead: 'Opus calls, screen and webcam sharing and chat, peer to peer, from a terminal. Open source, self-hostable, one 12 MB binary, and light enough to forget it is running.',
    mac: 'macOS',
    windows: 'Windows',
    thatIsIt: 'that is the whole setup',
    note: 'Nothing else to install. ffmpeg only if you want to share a screen or a camera.',
  },
  copy: { label: 'copy', done: 'copied' },
  tui: {
    title: 'openmeet · room standup · 4 participants',
    leave: 'leave',
    room: 'Room',
    messages: {
      '00:25': 'morning — did the Windows build ever finish?',
      '00:26': 'yeah, under a minute — it cross-builds from the mac now',
      '00:28': 'hey. audio is clean on my end this time, no robot voice',
      '00:30': 'good. the dropouts are gone on my side too',
      '00:31': 'let me put the trace up',
      '00:33':
        'that spike at the end is the camera opening — it holds the device for a moment after SIGTERM, which is why a preview right after a call used to fail',
      '00:35': 'so we wait for the exit instead of a timer?',
      '00:36': 'already in — stopCapture only resolves once the grabber is really gone',
      '00:38': 'sorry, late. my mic was on the wrong device again',
      '00:41': 'no worries, we are still on the capture path',
      '00:42': 'looks good to me',
      '00:43': 'one more pass on the docs and I will tag it',
    },
    events: { join: 'joined the room', screen: 'started screen sharing', mute: 'muted' },
    keys: {
      mute: 'mute',
      devices: 'devices',
      share: 'share',
      stopCam: 'stop cam',
      select: 'select',
      vol: 'vol',
      cam: 'cam',
      screen: 'screen',
      chat: 'chat',
    },
    placeholder: 'Type message...',
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
          { k: 'Codec', v: 'Opus 48 kHz', tone: 'ok', note: '· 64 kbps, one encoder for the room' },
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
      { name: 'macOS 15 or later', status: 'Supported', ok: true, features: 'Audio, chat, webcam, screen share' },
      { name: 'Windows 11', status: 'Supported', ok: true, features: 'Audio, chat, screen share' },
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
