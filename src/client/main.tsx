import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { HistoryDashboard } from './HistoryDashboard';
import { ParentSettings } from './ParentSettings';
import './style.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.pathname === '/settings' ? <ParentSettings /> : window.location.pathname === '/history' ? <HistoryDashboard /> : <App />}</React.StrictMode>);
