import React from 'react';
import { createRoot } from 'react-dom/client';
import { ActiveWorkspaceView } from '@pluggable-js/react';
import './plugins/rpa-cockpit';

function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 p-8 font-sans">
      <header className="mb-8 border-b border-slate-900 pb-4">
        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
          Cognitive RPA Engine
        </h1>
      </header>
      <main className="max-w-4xl mx-auto">
        <ActiveWorkspaceView
          role="rpa-workspace-view"
          passProps={{ websocketUrl: 'wss://api.rpa-saas.com/stream' }}
        />
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
