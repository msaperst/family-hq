import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { HistoryDashboard } from './HistoryDashboard';
import { ParentSettings } from './ParentSettings';
import './style.css';

function routeView(pathname: string) {
  if (pathname === '/settings') return <ParentSettings />;
  if (pathname === '/history') return <HistoryDashboard />;
  return <App />;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode>{routeView(window.location.pathname)}</React.StrictMode>);
