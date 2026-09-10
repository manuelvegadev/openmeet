import { Footer } from './components/footer';
import { Hero } from './components/hero';
import { Nav } from './components/nav';
import { Faq, Pillars, Platforms, SelfHostAndStack, Stories } from './components/sections';
import { Tui } from './components/tui';
import type { Lang } from './content/types';
import { CopyProvider } from './lib/i18n';

export function App({ lang }: { lang: Lang }) {
  return (
    <CopyProvider lang={lang}>
      <Nav />
      <main>
        <Hero />
        <Tui />
        <Pillars />
        <Stories />
        <Platforms />
        <SelfHostAndStack />
        <Faq />
      </main>
      <Footer />
    </CopyProvider>
  );
}
