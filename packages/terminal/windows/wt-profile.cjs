#!/usr/bin/env node
/**
 * Registers an "OpenMeet" profile in Windows Terminal so the app opens in its own window:
 * app icon and name in the title row, painted in the app's background colour, no scrollbar,
 * closes when the app exits. Idempotent; keeps a backup of settings.json next to it.
 *
 *   node wt-profile.cjs [--command "<what to run>"] [--icon <path>]
 *
 * Defaults: command `openmeet` (the npm global bin), icon from %LOCALAPPDATA%\openmeet.
 * Windows Terminal limits: the new-tab/dropdown buttons cannot be hidden and the window /
 * taskbar icon stays Windows Terminal's. The theme below is global to the terminal.
 */
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const command = arg('--command', 'openmeet');
const icon = arg('--icon', path.join(process.env.LOCALAPPDATA ?? '', 'openmeet', 'openmeet-icon.png'));

const candidates = [
  path.join(process.env.LOCALAPPDATA ?? '', 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
  path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows Terminal', 'settings.json'),
];
// Windows Terminal only writes settings.json the first time it is opened, so on a fresh
// machine seed a minimal one in the LocalState directory its installer created.
const EMPTY_SETTINGS = '{"$schema":"https://aka.ms/terminal-profiles-schema","profiles":{"list":[]}}';
let file = candidates.find((p) => fs.existsSync(p));
if (!file) {
  const seedable = candidates.find((p) => fs.existsSync(path.dirname(p)));
  if (!seedable) {
    console.error('Windows Terminal settings.json not found; is Windows Terminal installed?');
    process.exit(1);
  }
  fs.writeFileSync(seedable, EMPTY_SETTINGS);
  file = seedable;
}

const raw = fs.readFileSync(file, 'utf8');
fs.writeFileSync(`${file}.openmeet-backup`, raw);
// settings.json may carry // comments (Windows Terminal's own template does).
const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));

const BG = '#282c34'; // One Half Dark background, what the TUI renders on

const profile = {
  name: 'OpenMeet',
  guid: '{7f1e3d2a-6c5b-4a9e-9d10-0c0ffee0a1b2}',
  commandline: `cmd /c ${command}`,
  icon,
  tabTitle: 'OpenMeet',
  suppressApplicationTitle: true,
  closeOnExit: 'always',
  scrollbarState: 'hidden',
  padding: '4',
  font: { face: 'Cascadia Mono', size: 11 },
  colorScheme: 'One Half Dark',
  useAcrylic: false,
  hidden: false,
};
cfg.profiles = cfg.profiles || {};
cfg.profiles.list = cfg.profiles.list || [];
const i = cfg.profiles.list.findIndex((p) => p.guid === profile.guid || p.name === 'OpenMeet');
if (i >= 0) cfg.profiles.list[i] = profile;
else cfg.profiles.list.push(profile);

// Title bar = tab row, painted in the app colour. (A classic title bar would hide the
// tabs but is drawn by Windows in its own colour, with the terminal's icon.)
cfg.showTabsInTitlebar = true;
cfg.alwaysShowTabs = true;
cfg.themes = (cfg.themes || []).filter((t) => t.name !== 'OpenMeet');
cfg.themes.push({
  name: 'OpenMeet',
  window: { applicationTheme: 'dark', useMica: false },
  tabRow: { background: BG, unfocusedBackground: BG },
  tab: { background: BG, unfocusedBackground: BG, showCloseButton: 'never', iconStyle: 'default' },
});
cfg.theme = 'OpenMeet';

fs.writeFileSync(file, JSON.stringify(cfg, null, 4));
console.log(`OpenMeet profile written to ${file}`);
