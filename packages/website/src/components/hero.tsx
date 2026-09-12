import { HERO_CHIPS } from '../content/demo';
import { useCopy } from '../lib/i18n';
import { INSTALL_DOCS_URL, INSTALL_MAC, INSTALL_WIN, RUN } from '../lib/site';
import { Chip, Cmd } from './ui';

export function Hero() {
  const c = useCopy();
  return (
    <section className="hero grid-bg">
      <div className="wrap hero__inner">
        <div className="hero__chips">
          {HERO_CHIPS.map((chip) => (
            <Chip key={chip}>{chip}</Chip>
          ))}
        </div>
        <h1 className="display hero__title">
          {c.hero.titlePlain}
          <span className="accent">{c.hero.titleAccent}</span>
        </h1>
        <p className="hero__lead">{c.hero.lead}</p>
        {/* Both lines are in the page; the one for this machine is picked by the page's own
            script (lib/copy.ts). Without it the macOS line shows and the link covers the rest. */}
        <div className="hero__install" data-os="mac">
          <Cmd cmd={INSTALL_MAC} os="mac" />
          <Cmd cmd={INSTALL_WIN} prompt=">" os="win" />
          <p className="hero__detected">
            <span data-for="mac">{c.hero.mac}</span>
            <span data-for="win">{c.hero.windows}</span>
            <span className="hero__sep">·</span>
            <a href={INSTALL_DOCS_URL}>{c.hero.other}</a>
          </p>
          <Cmd cmd={RUN} note={c.hero.thatIsIt} copy={false} />
        </div>
        <p className="muted hero__note">{c.hero.note}</p>
      </div>
    </section>
  );
}
