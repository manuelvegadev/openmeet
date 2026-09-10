import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { Head } from './document';
import { installCopyHandler } from './lib/copy';
import { langFromPath } from './lib/i18n';
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

installCopyHandler();
