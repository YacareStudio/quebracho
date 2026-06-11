import { useState, useCallback } from 'react';
import { Play, RefreshCw, Database, AlertCircle, Table2 } from 'lucide-react';
import { useStore } from '../store';
import type { DbQueryResult, Tab } from '../types';

interface Props {
  tab: Tab;
}

export default function DbQueryEditor({ tab }: Props) {
  const [query, setQuery] = useState(tab.content);
  const [result, setResult] = useState<DbQueryResult | undefined>(tab.dbResult);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateTabContent = useStore((s) => s.updateTabContent);
  const uiLanguage = useStore((s) => s.uiLanguage);

  const connections = useStore((s) => {
    // We need to find the connection by id; since connections are local to
    // DatabasePanel, we can't access them directly. Instead we rely on the
    // tab's stored connection info. For a real implementation we'd keep
    // connections in the store, but for now we reconstruct a minimal
    // DbConnection from the tab fields if they were stored there.
    // As a workaround, we'll pass the connection data through a window event
    // or keep it in the tab. For simplicity, the DatabasePanel passes the
    // full connection object when opening the tab.
    return null;
  });

  const handleQueryChange = useCallback(
    (newQuery: string) => {
      setQuery(newQuery);
      updateTabContent(tab.id, newQuery);
    },
    [tab.id, updateTabContent]
  );

  const handleRun = useCallback(async () => {
    if (!query.trim() || !tab.dbConnectionId) return;
    setRunning(true);
    setError(null);

    try {
      // Retrieve the connection data from a global registry populated by
      // DatabasePanel when opening tabs.
      const conn = (window as any).__qbDbConnections?.[tab.dbConnectionId];
      if (!conn) {
        setError(uiLanguage === 'es' ? 'Conexión no encontrada' : 'Connection not found');
        setRunning(false);
        return;
      }

      const res = await window.forgeAPI.database.executeQuery(conn, query);
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }, [query, tab.dbConnectionId, uiLanguage]);

  return (
    <div className="w-full h-full flex flex-col bg-quebracho-editor">
      {/* Toolbar */}
      <div className="flex items-center gap-2 h-[35px] pl-3 pr-3 border-b border-quebracho-border/40 shrink-0 bg-quebracho-tabbar">
        <Database size={14} className="text-quebracho-accent" />
        <span className="text-[12px] text-quebracho-text-strong truncate flex-1">
          {tab.dbConnectionName}
        </span>
        <button
          onClick={() => void handleRun()}
          disabled={running}
          className="flex items-center gap-1 pl-2.5 pr-2.5 pt-1 pb-1 rounded text-[11px] bg-quebracho-accent text-quebracho-bg hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {running ? <RefreshCw size={11} className="animate-spin" /> : <Play size={11} />}
          {uiLanguage === 'es' ? 'Ejecutar' : 'Run'}
        </button>
      </div>

      {/* SQL Editor */}
      <div className="shrink-0 flex flex-col border-b border-quebracho-border/30">
        <textarea
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void handleRun();
            }
          }}
          className="w-full bg-quebracho-editor text-quebracho-text text-[13px] font-mono p-3 resize-none outline-none"
          style={{ minHeight: 80, maxHeight: 200 }}
          spellCheck={false}
          placeholder={uiLanguage === 'es' ? 'Escribí tu consulta SQL...' : 'Write your SQL query...'}
        />
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto sidebar-scroll min-h-0">
        {error && (
          <div className="flex items-center gap-2 p-4 text-[12px] text-red-400">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {result && (
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 pl-3 pr-3 pt-2 pb-2 border-b border-quebracho-border/30 bg-quebracho-tabbar/50">
              <Table2 size={12} className="text-quebracho-text-dim" />
              <span className="text-[11px] text-quebracho-text-dim">
                {result.rows.length} {uiLanguage === 'es' ? 'fila(s)' : 'row(s)'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-quebracho-border/40 bg-quebracho-tabbar/30">
                    {result.columns.map((col) => (
                      <th
                        key={col}
                        className="text-left pl-3 pr-3 pt-1.5 pb-1.5 text-quebracho-text-dim font-medium whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      className="border-b border-quebracho-border/20 hover:bg-white/[0.03]"
                    >
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          className="pl-3 pr-3 pt-1.5 pb-1.5 text-quebracho-text whitespace-nowrap"
                        >
                          {cell ?? 'NULL'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!result && !error && (
          <div className="flex flex-col items-center justify-center gap-2 h-full text-quebracho-text-dim">
            <Table2 size={28} className="opacity-30" />
            <p className="text-[12px]">
              {uiLanguage === 'es'
                ? 'Escribí una consulta y presioná Ejecutar'
                : 'Write a query and press Run'}
            </p>
            <p className="text-[11px] opacity-60">
              {uiLanguage === 'es' ? 'Ctrl+Enter para ejecutar' : 'Ctrl+Enter to run'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
