import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Archivo, the display face of the #955 redesign (headings and big numbers): one variable file with the
// weight and the width axis, self-hosted like Inter and IBM Plex Mono. Imported here and nowhere else;
// stylesheets name it through --font-display (styles/tokens.css).
import '@fontsource-variable/archivo/wdth.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
