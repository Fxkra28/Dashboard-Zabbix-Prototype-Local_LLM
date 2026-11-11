import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { reloadOnStaleChunks } from './features/shell/ErrorBoundary';
import { loadCapabilities } from './features/assistant/useAi';
import './styles/index.css';

reloadOnStaleChunks();

// Public and cheap: learns the server's time zone before a page labels a time in it (shared/lib/time.ts).
void loadCapabilities();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
