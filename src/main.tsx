import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import '@xterm/xterm/css/xterm.css';

// Tag the document so platform-specific chrome (e.g. the 78px traffic-light
// spacer in the title bar) only applies where it makes sense. We can't rely
// on Tauri's os plugin without an extra dependency, but the WKWebView /
// webkit2gtk / WebView2 user-agent strings reliably indicate the host OS.
const ua = navigator.userAgent;
const root = document.documentElement;
if (/Mac OS X|Macintosh/.test(ua)) root.classList.add('platform-mac');
else if (/Windows/.test(ua)) root.classList.add('platform-windows');
else if (/Linux/.test(ua)) root.classList.add('platform-linux');

// Suppress the WebView's built-in right-click menu (the "Reload" /
// inspect menu) — this is a desktop app, not a web page. Editable
// fields keep their native menu so right-click paste still works
// there; the app's own context menus (tab strip, file rows, …) call
// preventDefault and render their own UI, so they're unaffected.
document.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
