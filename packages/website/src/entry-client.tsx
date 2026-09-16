import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { Head } from './document';
import { installCopyHandler } from './lib/copy';
import { langFromPath } from './lib/i18n';
import { installSavedLook, installThemePanel } from './lib/theme';
import './styles/site.scss';

// Dev only. The published pages are static HTML from entry-server.tsx with no React on the
// client (prerender.mjs keeps the stylesheet and drops this bundle); here the template is
// empty, so render the page and let React 19 hoist the head tags.
const lang = langFromPath(location.pathname);
const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <Head lang={lang} />
    <App lang={lang} />
  </StrictMode>,
);

installSavedLook();
installCopyHandler();

// The panel's markup has to exist before it can be wired. On the published page that is free —
// the script is the last thing in the body — but here React renders when it is ready, so wait
// for the element rather than guessing at a delay.
const whenPanelExists = () => {
  if (document.querySelector('.look')) installThemePanel();
  else requestAnimationFrame(whenPanelExists);
};
requestAnimationFrame(whenPanelExists);
