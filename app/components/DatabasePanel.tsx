import { useState, useRef, useCallback, useEffect } from 'react';
import { useStore } from '../store';
import {
  Database,
  Server,
  Plug,
  AlertCircle,
  CheckCircle2,
  FileJson,
  Table2,
  Play,
  X,
  ChevronRight,
  ChevronDown,
  Pencil,
} from 'lucide-react';
import { t } from '../i18n';
import type { DbConnection } from '../types';

type DbType = 'mysql' | 'postgresql' | 'sqlite' | 'sqlserver';

const DB_TYPES: { id: DbType; label: string; defaultPort: number }[] = [
  { id: 'mysql', label: 'MySQL / MariaDB', defaultPort: 3306 },
  { id: 'postgresql', label: 'PostgreSQL', defaultPort: 5432 },
  { id: 'sqlite', label: 'SQLite', defaultPort: 0 },
  { id: 'sqlserver', label: 'SQL Server', defaultPort: 1433 },
];

const DB_ICON_COLORS: Record<DbType, string> = {
  mysql: '#E67E22',
  postgresql: '#3498DB',
  sqlite: '#F1C40F',
  sqlserver: '#E74C3C',
};

function DbTypeIcon({ type, size = 12 }: { type: DbType; size?: number }) {
  const color = DB_ICON_COLORS[type];
  if (type === 'sqlite') return <FileJson size={size} style={{ color }} />;
  if (type === 'sqlserver') return <Server size={size} style={{ color }} />;
  return <Database size={size} style={{ color }} />;
}

const MOCK_TABLES: Record<DbType, string[]> = {
  mysql: ['users', 'orders', 'products', 'categories', 'sessions'],
  postgresql: ['users', 'orders', 'products', 'categories', 'logs'],
  sqlite: [], // real tables loaded from file
  sqlserver: ['Users', 'Orders', 'Products', 'Inventory', 'Logs'],
};

export default function DatabasePanel() {
  const uiLanguage = useStore((s) => s.uiLanguage);
  const workspacePath = useStore((s) => s.workspacePath);
  const openDbQueryTab = useStore((s) => s.openDbQueryTab);

  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const [dbType, setDbType] = useState<DbType>('mysql');
  const [name, setName] = useState('');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('3306');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('');
  const [filePath, setFilePath] = useState('');

  const [connecting, setConnecting] = useState(false);
  const [connectStatus, setConnectStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectMessage, setConnectMessage] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [realTables, setRealTables] = useState<Record<string, string[]>>({});
  const [tablesExpanded, setTablesExpanded] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Load persisted connections on mount
  useEffect(() => {
    let cancelled = false;
    window.forgeAPI.database
      .loadConnections()
      .then((list) => {
        if (cancelled) return;
        setConnections(list);
        if (list.length > 0 && !activeConnectionId) {
          setActiveConnectionId(list[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a global registry so DbQueryEditor can access connection details
  useEffect(() => {
    const registry: Record<string, DbConnection> = {};
    for (const c of connections) {
      registry[c.id] = c;
    }
    (window as any).__qbDbConnections = registry;
  }, [connections]);

  // Persist whenever connections change
  useEffect(() => {
    if (loading) return;
    window.forgeAPI.database.saveConnections(connections).catch(() => {});
  }, [connections, loading]);

  // Load real SQLite tables when a SQLite connection becomes active
  useEffect(() => {
    const conn = connections.find((c) => c.id === activeConnectionId);
    if (!conn || conn.dbType !== 'sqlite' || !conn.filePath) return;
    if (realTables[conn.id]) return;

    window.forgeAPI.database
      .listSqliteTables(conn.filePath)
      .then((tables) => {
        setRealTables((prev) => ({ ...prev, [conn.id]: tables }));
      })
      .catch(() => {
        setRealTables((prev) => ({ ...prev, [conn.id]: [] }));
      });
  }, [activeConnectionId, connections, realTables]);

  const resetForm = () => {
    setDbType('mysql');
    setName('');
    setHost('localhost');
    setPort('3306');
    setUser('');
    setPassword('');
    setDatabase('');
    setFilePath('');
    setConnectStatus('idle');
    setConnectMessage('');
  };

  const handleDbTypeChange = (type: DbType) => {
    setDbType(type);
    const info = DB_TYPES.find((d) => d.id === type);
    if (info && info.defaultPort > 0) {
      setPort(String(info.defaultPort));
    }
  };

  const handleConnect = async () => {
    if (!name.trim()) {
      setConnectStatus('error');
      setConnectMessage(t(uiLanguage, 'database.errorNameRequired'));
      return;
    }
    setConnecting(true);
    setConnectStatus('idle');
    setConnectMessage('');

    const newConn: DbConnection = {
      id: crypto.randomUUID(),
      name: name.trim(),
      dbType,
      host: dbType === 'sqlite' ? undefined : host || undefined,
      port: dbType === 'sqlite' ? undefined : parseInt(port, 10) || undefined,
      user: dbType === 'sqlite' ? undefined : user || undefined,
      password: dbType === 'sqlite' ? undefined : password || undefined,
      database: dbType === 'sqlite' ? undefined : database || undefined,
      filePath: dbType === 'sqlite' ? filePath || undefined : undefined,
    };

    // Try real connection for server DBs
    if (dbType !== 'sqlite') {
      try {
        await window.forgeAPI.database.testConnection(newConn);
      } catch (e) {
        setConnectStatus('error');
        setConnectMessage(String(e));
        setConnecting(false);
        return;
      }
    }

    setConnections((prev) => [...prev, newConn]);
    setActiveConnectionId(newConn.id);
    setConnectStatus('success');
    setConnectMessage(t(uiLanguage, 'database.connectionSaved'));
    setShowForm(false);
    resetForm();
    setConnecting(false);
  };

  const handleRemoveConnection = (id: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== id));
    if (activeConnectionId === id) setActiveConnectionId(null);
    setRealTables((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const startRename = (conn: DbConnection) => {
    setEditingId(conn.id);
    setEditingName(conn.name);
  };

  const commitRename = () => {
    if (!editingId) return;
    const trimmed = editingName.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    setConnections((prev) =>
      prev.map((c) => (c.id === editingId ? { ...c, name: trimmed } : c))
    );
    setEditingId(null);
  };

  const activeConnection = connections.find((c) => c.id === activeConnectionId);

  const getTables = useCallback(
    (conn: DbConnection): string[] => {
      if (conn.dbType === 'sqlite') {
        return realTables[conn.id] || [];
      }
      return MOCK_TABLES[conn.dbType];
    },
    [realTables]
  );

  const runQueryInEditor = useCallback(
    async (query: string) => {
      if (!activeConnection) return;
      try {
        const result = await window.forgeAPI.database.executeQuery(activeConnection, query);
        openDbQueryTab(activeConnection.id, activeConnection.name, query, result);
      } catch (e) {
        // If real execution fails, open the tab anyway so the user sees the error
        const errResult = {
          columns: ['error'],
          rows: [[String(e)]],
        };
        openDbQueryTab(activeConnection.id, activeConnection.name, query, errResult);
      }
    },
    [activeConnection, openDbQueryTab]
  );

  const handleOpenTable = useCallback(
    (table: string) => {
      const query = `SELECT * FROM ${table} LIMIT 10;`;
      void runQueryInEditor(query);
    },
    [runQueryInEditor]
  );

  if (!workspacePath) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-quebracho-text/50 text-sm pl-4 pr-4">
        <Database size={28} />
        <p>{t(uiLanguage, 'searchPanel.openProjectFirst')}</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-quebracho-sidebar overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between h-9 pl-3 pr-3 border-b border-quebracho-border/40 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-quebracho-text">
          {t(uiLanguage, 'database.title')}
        </span>
        <button
          onClick={() => {
            setShowForm(!showForm);
            resetForm();
          }}
          title={t(uiLanguage, 'database.addConnection')}
          className="h-5 w-5 flex items-center justify-center rounded text-quebracho-text hover:text-quebracho-text-strong hover:bg-quebracho-hover transition-colors"
        >
          <span className="text-[13px] leading-none">+</span>
        </button>
      </div>

      {/* Connection list */}
      {connections.length > 0 && (
        <div className="border-b border-quebracho-border/40 max-h-40 overflow-y-auto sidebar-scroll shrink-0">
          {connections.map((conn) => {
            const isActive = conn.id === activeConnectionId;
            return (
              <div
                key={conn.id}
                onClick={() => setActiveConnectionId(conn.id)}
                className={`group flex items-center gap-2 pl-3 pr-3 h-7 cursor-pointer text-[12px] transition-colors
                  ${isActive ? 'bg-quebracho-accent/10 text-quebracho-accent' : 'text-quebracho-text hover:bg-quebracho-hover'}
                `}
              >
                <DbTypeIcon type={conn.dbType} size={13} />

                {editingId === conn.id ? (
                  <input
                    ref={editInputRef}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={commitRename}
                    autoFocus
                    className="quebracho-input flex-1 text-[12px] h-5 py-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="truncate flex-1">{conn.name}</span>
                )}

                {isActive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />}

                {editingId !== conn.id && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(conn);
                      }}
                      className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-quebracho-text-dim transition-opacity"
                      title={t(uiLanguage, 'titleBar.editRename')}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveConnection(conn.id);
                      }}
                      className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-quebracho-text-dim hover:text-red-400 transition-opacity"
                      title={t(uiLanguage, 'database.removeConnection')}
                    >
                      <X size={11} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New connection form */}
      {showForm && (
        <div className="flex-1 overflow-y-auto sidebar-scroll p-3">
          <div className="text-[11px] text-quebracho-text-dim mb-2 uppercase tracking-wider">
            {t(uiLanguage, 'database.newConnection')}
          </div>

          {/* DB type selector */}
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            {DB_TYPES.map((db) => (
              <button
                key={db.id}
                onClick={() => handleDbTypeChange(db.id)}
                className={`text-left pl-2 pr-2 pt-1.5 pb-1.5 rounded text-[11px] border transition-colors
                  ${dbType === db.id
                    ? 'border-quebracho-accent bg-quebracho-accent/10 text-quebracho-accent'
                    : 'border-quebracho-border bg-quebracho-input/40 text-quebracho-text hover:bg-quebracho-input'}
                `}
              >
                {db.label}
              </button>
            ))}
          </div>

          {/* Connection name */}
          <div className="mb-2">
            <label className="block text-[10px] text-quebracho-text-dim mb-0.5">
              {t(uiLanguage, 'database.connectionName')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(uiLanguage, 'database.connectionNamePlaceholder')}
              className="quebracho-input w-full text-[12px]"
            />
          </div>

          {dbType === 'sqlite' ? (
            /* SQLite file path */
            <div className="mb-2">
              <label className="block text-[10px] text-quebracho-text-dim mb-0.5">
                {t(uiLanguage, 'database.filePath')}
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="/path/to/database.db"
                  className="quebracho-input flex-1 text-[12px]"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="pl-2 pr-2 rounded bg-quebracho-input hover:bg-quebracho-hover text-quebracho-text text-[11px] transition-colors"
                >
                  …
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".db,.sqlite,.sqlite3"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setFilePath(f.name);
                  }}
                />
              </div>
            </div>
          ) : (
            /* Server connection fields */
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="block text-[10px] text-quebracho-text-dim mb-0.5">
                    {t(uiLanguage, 'database.host')}
                  </label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="quebracho-input w-full text-[12px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-quebracho-text-dim mb-0.5">
                    {t(uiLanguage, 'database.port')}
                  </label>
                  <input
                    type="text"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="quebracho-input w-full text-[12px]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="block text-[10px] text-quebracho-text-dim mb-0.5">
                    {t(uiLanguage, 'database.user')}
                  </label>
                  <input
                    type="text"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    className="quebracho-input w-full text-[12px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-quebracho-text-dim mb-0.5">
                    {t(uiLanguage, 'database.password')}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="quebracho-input w-full text-[12px]"
                  />
                </div>
              </div>

              <div className="mb-2">
                <label className="block text-[10px] text-quebracho-text-dim mb-0.5">
                  {t(uiLanguage, 'database.database')}
                </label>
                <input
                  type="text"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  className="quebracho-input w-full text-[12px]"
                />
              </div>
            </>
          )}

          {/* Status message */}
          {connectStatus !== 'idle' && (
            <div
              className={`flex items-center gap-1.5 mb-2 text-[11px]
                ${connectStatus === 'error' ? 'text-red-400' : 'text-emerald-400'}
              `}
            >
              {connectStatus === 'error' ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
              {connectMessage}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleConnect}
              disabled={connecting}
              className={`flex-1 flex items-center justify-center gap-1.5 pl-3 pr-3 pt-1.5 pb-1.5 rounded text-[12px] font-medium transition-colors
                ${connecting
                  ? 'bg-quebracho-input/60 text-quebracho-text-dim cursor-not-allowed'
                  : 'bg-quebracho-accent text-quebracho-bg hover:opacity-90'}
              `}
            >
              <Plug size={13} />
              {connecting ? t(uiLanguage, 'database.connecting') : t(uiLanguage, 'database.connect')}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="pl-3 pr-3 pt-1.5 pb-1.5 rounded text-[12px] text-quebracho-text hover:bg-quebracho-hover transition-colors"
            >
              {t(uiLanguage, 'database.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Active connection detail */}
      {!showForm && activeConnection && (
        <div className="flex-1 overflow-y-auto sidebar-scroll min-h-0">
          {/* Connection info */}
          <div className="flex items-center gap-2 pl-3 pr-3 pt-2 pb-2 border-b border-quebracho-border/30">
            <DbTypeIcon type={activeConnection.dbType} size={14} />
            <span className="text-[12px] text-quebracho-text-strong truncate flex-1">
              {activeConnection.name}
            </span>
            <button
              onClick={() => {
                const query = `SELECT * FROM information_schema.tables LIMIT 10;`;
                void runQueryInEditor(query);
              }}
              className="flex items-center gap-1 pl-2 pr-2 pt-1 pb-1 rounded text-[11px] bg-quebracho-accent/10 text-quebracho-accent hover:bg-quebracho-accent/20 transition-colors"
            >
              <Play size={10} />
              {t(uiLanguage, 'database.runQuery')}
            </button>
          </div>

          {/* Tables list */}
          <div className="flex flex-col">
            <button
              onClick={() => setTablesExpanded((p) => !p)}
              className="flex items-center gap-1.5 pl-3 pr-3 h-7 text-[11px] text-quebracho-text-dim hover:bg-quebracho-hover transition-colors"
            >
              {tablesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Table2 size={12} />
              {t(uiLanguage, 'database.tables')}
            </button>

            {tablesExpanded && (
              <div className="pb-1">
                {getTables(activeConnection).map((table) => (
                  <div
                    key={table}
                    onDoubleClick={() => handleOpenTable(table)}
                    className="flex items-center gap-2 pl-8 pr-3 h-6 cursor-pointer text-[12px] text-quebracho-text hover:bg-quebracho-hover transition-colors"
                    title={`${table} — ${uiLanguage === 'es' ? 'Doble clic para abrir' : 'Double-click to open'}`}
                  >
                    <Table2 size={11} className="text-quebracho-text-dim" />
                    <span className="truncate">{table}</span>
                  </div>
                ))}
                {getTables(activeConnection).length === 0 && (
                  <div className="pl-8 pr-3 h-6 text-[11px] text-quebracho-text-dim/60 italic">
                    {activeConnection.dbType === 'sqlite'
                      ? uiLanguage === 'es'
                        ? 'Cargando tablas…'
                        : 'Loading tables…'
                      : uiLanguage === 'es'
                        ? 'No hay tablas (modo simulado)'
                        : 'No tables (mock mode)'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!showForm && !activeConnection && (
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
          <Database size={32} className="text-quebracho-text-dim mb-3 opacity-40" />
          <p className="text-[12px] text-quebracho-text-dim">
            {t(uiLanguage, 'database.emptyState')}
          </p>
          <button
            onClick={() => {
              setShowForm(true);
              resetForm();
            }}
            className="mt-3 text-[12px] text-quebracho-accent hover:underline"
          >
            {t(uiLanguage, 'database.addConnection')}
          </button>
        </div>
      )}
    </div>
  );
}
