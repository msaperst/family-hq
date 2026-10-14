import { useEffect, useState } from 'react';
import type { HealthResponse } from '../shared/health';

export function App() {
  const [status, setStatus] = useState('Checking connection…');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('API unavailable');
        return response.json() as Promise<HealthResponse>;
      })
      .then(health => setStatus(health.status === 'ok' ? 'Connected' : 'API unavailable'))
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === 'AbortError')) setStatus('API unavailable');
      });
    return () => controller.abort();
  }, []);
  return <main><h1>Family HQ</h1><p>Household dashboard — foundation in progress.</p><p role="status">API: {status}</p></main>;
}
