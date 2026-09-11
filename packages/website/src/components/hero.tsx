import { HERO_CHIPS } from '../content/demo';
import { useCopy } from '../lib/i18n';
import { INSTALL_MAC, INSTALL_WIN, RUN } from '../lib/site';
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
        <div className="hero__install">
          <Cmd cmd={INSTALL_MAC} note={c.hero.mac} />
          <Cmd cmd={INSTALL_WIN} note={c.hero.windows} prompt=">" />
          <Cmd cmd={RUN} note={c.hero.thatIsIt} copy={false} />
        </div>
        <p className="muted hero__note">{c.hero.note}</p>
      </div>
    </section>
  );
}
