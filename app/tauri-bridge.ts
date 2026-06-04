import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import type { ForgeAPI, FsChangeEvent } from './types';

type DisposeLike = { dispose: () => void };

const isTauriRuntime =
  typeof window !== 'undefined' &&
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';

const fsChangedHandlers = new Map<
  (event: FsChangeEvent) => void,
  () => void
>();

const workspaceRestoreHandlers = new Set<(workspacePath: string) => void>();

let restoreEmitted = false;

async function emitWorkspaceRestoreIfNeeded(): Promise<void> {
  if (restoreEmitted) return;
  restoreEmitted = true;
  try {
    const last = await invoke<string | null>('get_last_workspace');
    if (!last) return;
    for (const cb of workspaceRestoreHandlers) {
      cb(last);
    }
  } catch {
    // no-op
  }
}

const bridge: ForgeAPI = {
  openFolder: async () => {
    const result = await open({ directory: true, multiple: false });
    if (!result || Array.isArray(result)) return null;
    const selected = result.toString();
    await invoke('remember_workspace', { workspacePath: selected });
    return selected;
  },
  openFile: async () => {
    const result = await open({ directory: false, multiple: false });
    if (!result || Array.isArray(result)) return null;
    return result.toString();
  },
  readDirectory: (dirPath: string) => invoke('read_directory', { dirPath }),
  readFile: (filePath: string) => invoke('read_file', { filePath }),
  readImageDataUrl: (filePath: string) => invoke('read_image_data_url', { filePath }) as Promise<{ dataUrl: string; size: number }>,
  writeFile: (filePath: string, content: string) => invoke('write_file', { filePath, content }),
  createFile: (filePath: string) => invoke('create_file', { filePath }),
  createDirectory: (dirPath: string) => invoke('create_directory', { dirPath }),
  deleteItem: (itemPath: string) => invoke('delete_item', { itemPath }),
  renameItem: (oldPath: string, newPath: string) => invoke('rename_item', { oldPath, newPath }),

  watchWorkspace: async (dirPath: string) => {
    await invoke('remember_workspace', { workspacePath: dirPath });
    return invoke('watch_workspace', { dirPath });
  },
  unwatchWorkspace: () => invoke('unwatch_workspace'),
  onFsChanged: (callback) => {
    if (!isTauriRuntime) return;
    const unlistenPromise = listen<FsChangeEvent>('fs:changed', (event) => {
      callback(event.payload);
    });
    fsChangedHandlers.set(callback, () => {
      void unlistenPromise.then((u) => u());
    });
  },
  offFsChanged: (callback) => {
    if (callback) {
      const dispose = fsChangedHandlers.get(callback);
      if (dispose) {
        dispose();
        fsChangedHandlers.delete(callback);
      }
      return;
    }
    for (const dispose of fsChangedHandlers.values()) {
      dispose();
    }
    fsChangedHandlers.clear();
  },
  onWorkspaceRestore: (callback) => {
    workspaceRestoreHandlers.add(callback);
    void emitWorkspaceRestoreIfNeeded();
    return {
      dispose: () => {
        workspaceRestoreHandlers.delete(callback);
      },
    };
  },

  minimize: () => {
    if (!isTauriRuntime) return;
    void getCurrentWindow().minimize();
  },
  maximize: () => {
    if (!isTauriRuntime) return;
    const w = getCurrentWindow();
    void w.isMaximized().then((max) => {
      if (max) {
        void w.unmaximize();
      } else {
        void w.maximize();
      }
    });
  },
  close: () => {
    if (!isTauriRuntime) return;
    void getCurrentWindow().close();
  },
  appInfo: () => invoke('app_info'),
  updates: {
    checkAndInstall: () => invoke('app_check_for_updates'),
  },

  terminalCreate: (opts) => invoke('terminal_create', opts),
  terminalWrite: (id, data) => {
    void invoke('terminal_write', { id, data });
  },
  terminalResize: (id, cols, rows) => {
    void invoke('terminal_resize', { id, cols, rows });
  },
  terminalKill: (id) => {
    void invoke('terminal_kill', { id });
  },
  terminalSendCommand: (id, command) => {
    void invoke('terminal_send_command', { id, command });
  },
  terminalOnData: (id, callback) => {
    let disposed = false;
    const unlistenPromise = listen<{ id: string; data: string }>('terminal:data', (event) => {
      if (disposed) return;
      if (event.payload?.id !== id) return;
      callback(String(event.payload?.data ?? ''));
    });
    return {
      dispose: () => {
        disposed = true;
        void unlistenPromise.then((u) => u());
      },
    };
  },
  terminalOnExit: (id, callback) => {
    let disposed = false;
    const unlistenPromise = listen<{ id: string; code: number }>('terminal:exit', (event) => {
      if (disposed) return;
      if (event.payload?.id !== id) return;
      callback(Number(event.payload?.code ?? -1));
    });
    return {
      dispose: () => {
        disposed = true;
        void unlistenPromise.then((u) => u());
      },
    };
  },

  readClipboard: async () => {
    try {
      // Dynamic import keeps this baseline bridge working even if the plugin
      // is not installed yet in some environments.
      const mod = await import('@tauri-apps/plugin-clipboard-manager');
      return await mod.readText();
    } catch {
      return '';
    }
  },

  settings: {
    getLanguage: async () => {
      if (!isTauriRuntime) {
        try {
          const raw = localStorage.getItem('quebracho.uiLanguage');
          if (!raw) return null;
          return raw === 'en' ? 'en' : 'es';
        } catch {
          return null;
        }
      }
      const raw = await invoke<string | null>('ui_get_language');
      if (!raw) return null;
      return raw.toLowerCase().startsWith('en') ? 'en' : 'es';
    },
    setLanguage: async (language) => {
      if (!isTauriRuntime) {
        try {
          localStorage.setItem('quebracho.uiLanguage', language);
          return true;
        } catch {
          return false;
        }
      }
      return invoke('ui_set_language', { language });
    },
    getTerminalShell: async () => {
      if (!isTauriRuntime) {
        try {
          const raw = localStorage.getItem('quebracho.terminalShell');
          return raw && raw.trim().length > 0 ? raw : null;
        } catch {
          return null;
        }
      }
      const raw = await invoke<string | null>('ui_get_terminal_shell');
      if (!raw || !raw.trim()) return null;
      return raw;
    },
    setTerminalShell: async (shell) => {
      if (!isTauriRuntime) {
        try {
          if (!shell || !shell.trim()) localStorage.removeItem('quebracho.terminalShell');
          else localStorage.setItem('quebracho.terminalShell', shell);
          return true;
        } catch {
          return false;
        }
      }
      return invoke('ui_set_terminal_shell', { shell });
    },
    getColorTheme: async () => {
      if (!isTauriRuntime) {
        try {
          const raw = localStorage.getItem('quebracho.colorTheme');
          return raw && raw.trim().length > 0 ? raw : null;
        } catch {
          return null;
        }
      }
      const raw = await invoke<string | null>('ui_get_color_theme');
      if (!raw || !raw.trim()) return null;
      return raw;
    },
    setColorTheme: async (theme) => {
      if (!isTauriRuntime) {
        try {
          if (!theme || !theme.trim()) localStorage.removeItem('quebracho.colorTheme');
          else localStorage.setItem('quebracho.colorTheme', theme);
          return true;
        } catch {
          return false;
        }
      }
      return invoke('ui_set_color_theme', { theme });
    },
    getFileIconTheme: async () => {
      if (!isTauriRuntime) {
        try {
          const raw = localStorage.getItem('quebracho.fileIconTheme');
          return raw && raw.trim().length > 0 ? raw : null;
        } catch {
          return null;
        }
      }
      const raw = await invoke<string | null>('ui_get_file_icon_theme');
      if (!raw || !raw.trim()) return null;
      return raw;
    },
    setFileIconTheme: async (theme) => {
      if (!isTauriRuntime) {
        try {
          if (!theme || !theme.trim()) localStorage.removeItem('quebracho.fileIconTheme');
          else localStorage.setItem('quebracho.fileIconTheme', theme);
          return true;
        } catch {
          return false;
        }
      }
      return invoke('ui_set_file_icon_theme', { theme });
    },
  },

  liveServer: {
    start: async (htmlPath) => {
      const status = await invoke<{ active: boolean; port: number | null; root: string | null; html_file: string | null; htmlFile?: string | null; url: string | null }>('live_server_start', { htmlPath });
      return {
        active: status.active,
        port: status.port,
        root: status.root,
        htmlFile: status.htmlFile ?? status.html_file ?? null,
        url: status.url,
      };
    },
    stop: () => invoke('live_server_stop'),
    status: async () => {
      const status = await invoke<{ active: boolean; port: number | null; root: string | null; html_file: string | null; htmlFile?: string | null; url: string | null }>('live_server_status');
      return {
        active: status.active,
        port: status.port,
        root: status.root,
        htmlFile: status.htmlFile ?? status.html_file ?? null,
        url: status.url,
      };
    },
    onStatusChange: (callback) => {
      if (!isTauriRuntime) {
        return {
          dispose: () => undefined,
        };
      }
      const unlistenPromise = listen<{ active: boolean; port: number | null; root: string | null; html_file: string | null; htmlFile?: string | null; url: string | null }>('live-server:status', (event) => {
        const payload = event.payload;
        callback({
          active: payload.active,
          port: payload.port,
          root: payload.root,
          htmlFile: payload.htmlFile ?? payload.html_file ?? null,
          url: payload.url,
        });
      });
      return {
        dispose: () => {
          void unlistenPromise.then((u) => u());
        },
      };
    },
  },

  lsp: {
    start: (workspacePath) => invoke('lsp_start', { workspacePath }),
    stop: () => invoke('lsp_stop'),
    request: (method, params) => invoke('lsp_request', { args: { method, params } }),
    notification: (method, params) => {
      void invoke('lsp_notification', { args: { method, params } });
    },
    onDiagnostics: (callback) => {
      const unlistenPromise = listen('lsp:diagnostics', (event) => {
        callback(event.payload as any);
      });
      return {
        dispose: () => {
          void unlistenPromise.then((u) => u());
        },
      };
    },
    onNotification: (callback) => {
      const unlistenPromise = listen<{ method: string; params: any }>('lsp:notification', (event) => {
        callback(event.payload?.method ?? '', event.payload?.params);
      });
      return {
        dispose: () => {
          void unlistenPromise.then((u) => u());
        },
      };
    },
  },

  ai: {
    listProviders: () => invoke('ai_list_providers'),
    getConfig: () => invoke('ai_get_config'),
    setApiKey: (provider, apiKey) => invoke('ai_set_api_key', { provider, apiKey }),
    removeApiKey: (provider) => invoke('ai_remove_api_key', { provider }),
    setActive: (provider, model) => invoke('ai_set_active', { provider, model }),
    listModels: (provider) => invoke('ai_list_models', { provider }),
    chatStream: (args) => invoke('ai_chat_stream', { args }),
    abortStream: (streamId) => invoke('ai_abort_stream', { streamId }),
    onStream: (streamId, callback) => {
      const unlistenPromise = listen<{ streamId: string; event: 'delta' | 'done' | 'error'; data: any }>('ai:stream', (event) => {
        if (event.payload?.streamId !== streamId) return;
        callback(event.payload.event, event.payload.data);
      });
      return {
        dispose: () => {
          void unlistenPromise.then((u) => u());
        },
      };
    },
  },

  quebracho: {
    readHistory: (workspacePath) => invoke('forge_read_history', { workspacePath }),
    writeHistory: (workspacePath, messages) => invoke('forge_write_history', { workspacePath, messages }),
    ensureForgeDir: (workspacePath) => invoke('forge_ensure_forge_dir', { workspacePath }),
    hasHistory: (workspacePath) => invoke('forge_has_history', { workspacePath }),
  },

  agent: {
    leerArchivo: (workspacePath, ruta) => invoke('agent_leer_archivo', { workspacePath, ruta }),
    escribirArchivo: (workspacePath, ruta, contenido) => invoke('agent_escribir_archivo', { workspacePath, ruta, contenido }),
    listarCarpeta: (workspacePath, ruta) => invoke('agent_listar_carpeta', { workspacePath, ruta }),
    buscarEnProyecto: (workspacePath, texto) => invoke('agent_buscar_en_proyecto', { workspacePath, texto }),
    initContext: (workspacePath) => invoke('agent_init_context', { workspacePath }),
    snapshotFolder: (workspacePath, folderPath) => invoke('agent_snapshot_folder', { workspacePath, folderPath }),
    fileExists: (workspacePath, ruta) => invoke('agent_file_exists', { workspacePath, ruta }),
    readFileSafe: (workspacePath, ruta) => invoke('agent_read_file_safe', { workspacePath, ruta }),
  },
};

(window as Window & { forgeAPI?: ForgeAPI }).forgeAPI = bridge;

if (isTauriRuntime) {
  void emit('tauri-bridge-ready').catch(() => undefined);
}

export function getBridge(): ForgeAPI {
  return bridge;
}
