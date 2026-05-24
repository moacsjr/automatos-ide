import React, { useState, useEffect } from 'react';
import { pluginRegistry } from '@pluggable-js/core';
import { uiRegistry } from '@pluggable-js/react';

export function RpaCockpitComponent({
  passProps,
}: {
  passProps?: { websocketUrl: string };
}) {
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const ws = new WebSocket(passProps?.websocketUrl ?? 'ws://localhost:8080');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'LOG') setLogs((prev) => [...prev, data.message]);
      if (data.type === 'PROGRESS') setProgress(data.percentage);
    };
    return () => ws.close();
  }, [passProps]);

  return (
    <div className="p-6 bg-slate-900 text-slate-100 rounded-xl border border-slate-800 shadow-2xl">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold tracking-wide">RPA Cockpit - Monitor de Execucao</h3>
        <span className="text-xs font-mono bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full border border-emerald-500/20">
          Active Task
        </span>
      </div>
      <div className="w-full bg-slate-800 h-2.5 rounded-full mb-4 overflow-hidden">
        <div
          className="bg-gradient-to-r from-blue-500 to-emerald-500 h-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="bg-slate-950 p-4 rounded-lg h-60 overflow-y-auto font-mono text-xs text-emerald-400 border border-slate-900 leading-relaxed">
        {logs.map((log, index) => (
          <div key={index} className="border-b border-slate-900/50 pb-1 mb-1">
            {log}
          </div>
        ))}
      </div>
    </div>
  );
}

uiRegistry.registerComponent('rpa-workspace-view', RpaCockpitComponent);

pluginRegistry.register({
  id: 'rpa-execution-plugin',
  name: 'Pluggable Engine Execution Monitor',
  version: '1.0.0',
  type: 'feature',
  role: 'rpa-workspace-view',
});
