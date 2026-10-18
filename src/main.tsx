import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/global.css';
import { App } from './ui/App';

// ?still=1 skips the intro fade (deterministic stills for testing and sharing)
if (new URLSearchParams(window.location.search).get('still') === '1') document.documentElement.classList.add('no-intro');

createRoot(document.getElementById('root')!).render(<App />);
