import { create } from 'zustand';
import {
  TreeNode,
  Tab,
  SidebarPanel,
  BottomTab,
  CursorPosition,
  FsChangeEvent,
  getLanguageFromPath,
  isImageFile,
  AIMessage,
  LiveWrite,
  PendingDiff,
  ProviderId,
} from './types';
import { lspClient } from './lsp/client';
import { UILanguage, getInitialLanguage, normalizeLanguage, persistLanguage, t } from './i18n';
import {
  ColorThemeId,
  DEFAULT_COLOR_THEME,
  DEFAULT_FILE_ICON_THEME,
  FileIconThemeId,
  normalizeColorTheme,
  normalizeFileIconTheme,
} from './theme/appearance';

export type SelectedNodeKind = 'file' | 'directory';

export interface SelectedNode {
  path: string;
  kind: SelectedNodeKind;
}

interface EditorState {
  // Workspace
  workspacePath: string | null;
  workspaceName: string | null;
  fileTree: TreeNode[];
  expandedFolders: Set<string>;

  // Sidebar selection (independent of which tab is active in the editor)
  selectedPath: string | null;
  selectedKind: SelectedNodeKind | null;

  // Tabs & Editor
  openTabs: Tab[];
  activeTabId: string | null;

  // Layout
  sidebarVisible: boolean;
  bottomPanelVisible: boolean;
  activityBarVisible: boolean;
  statusBarVisible: boolean;
  activeSidebarPanel: SidebarPanel;
  activeBottomTab: BottomTab;
  /** Width of the sidebar column, in CSS pixels. */
  sidebarWidth: number;
  /** Height of the bottom panel (terminal), in CSS pixels. */
  bottomPanelHeight: number;

  // Terminal
  /** Id of the currently-mounted pty (set by BottomPanel/XTermView). */
  activeTerminalId: string | null;

  // Editor state
  cursorPosition: CursorPosition;
  hasTextSelection: boolean;
  commandPaletteOpen: boolean;
  uiLanguage: UILanguage;
  terminalShellPreference: string;
  colorTheme: ColorThemeId;
  fileIconTheme: FileIconThemeId;
  settingsModalOpen: boolean;

  // ── Live Server ─────────────────────────────────────────────────────
  /** True while the local HTTP server (port 5500) is up. */
  liveServerActive: boolean;
  /** Port the server is bound to (always 5500 today, kept here for future
   *  configurability and to drive the UI label). */
  liveServerPort: number | null;
  /** Absolute path of the directory the server is rooted at. */
  liveServerRoot: string | null;
  /** File name (relative to root) of the HTML page that started the server. */
  liveServerHtmlFile: string | null;
  /** Public URL the user can open in their browser. */
  liveServerUrl: string | null;

  // ── AI Panel ────────────────────────────────────────────────────────
  aiPanelVisible: boolean;
  aiPanelWidth: number;
  /** Modal: API-key configuration. */
  aiApiKeyModalOpen: boolean;
  /** Providers that have an API key stored (read from main process). */
  aiConfiguredProviders: ProviderId[];
  /** Currently-selected provider/model. */
  aiActiveProvider: ProviderId | null;
  aiActiveModel: string | null;
  /** Model lists by provider, populated lazily after key entry. */
  aiAvailableModels: Partial<Record<ProviderId, string[]>>;
  /** Whether the model dropdown is open. */
  aiModelMenuOpen: boolean;
  /** Keyring storage status: 'os' = system keychain, 'local' = JSON file. */
  aiKeyringStatus: 'os' | 'local' | null;
  /** Whether /init has produced a PROJECT.md for the current workspace. */
  aiInitDone: boolean;
  /** Conversation messages. */
  aiMessages: AIMessage[];
  /** Loop state: idle | streaming | running_tool | awaiting_diff. */
  aiStatus: 'idle' | 'streaming' | 'running_tool' | 'awaiting_diff' | 'initializing';
  /** Bottom-bar status text under the input ("Generando..."). */
  aiStatusText: string;
  /** Pending diff awaiting user decision. */
  aiPendingDiff: PendingDiff | null;
  /** Promise resolver waiting on the diff decision. */
  aiPendingDiffResolver: ((accepted: boolean) => void) | null;

  // ── AI Panel actions ────────────────────────────────────────────────
  toggleAIPanel: () => void;
  setAIPanelWidth: (width: number) => void;
  setAIApiKeyModalOpen: (open: boolean) => void;
  refreshAIConfig: () => Promise<void>;
  setAIAvailableModels: (provider: ProviderId, models: string[]) => void;
  setAIActive: (provider: ProviderId, model: string) => Promise<void>;
  /** Remove an API key for a provider. If it was the active one, clear it. */
  removeAIProvider: (provider: ProviderId) => Promise<void>;
  setAIModelMenuOpen: (open: boolean) => void;
  addAIMessage: (msg: AIMessage) => void;
  updateAIMessage: (id: string, patch: Partial<AIMessage>) => void;
  appendToAIMessage: (id: string, text: string) => void;
  clearAIConversation: () => void;
  setAIStatus: (status: EditorState['aiStatus'], text?: string) => void;
  setAIInitDone: (done: boolean) => void;
  setAIPendingDiff: (
    diff: PendingDiff | null,
    resolver?: ((accepted: boolean) => void) | null,
  ) => void;
  /** Load conversation history from `.quebracho/history.json` of the current
   *  workspace (or the provided one). Replaces `aiMessages` and updates
   *  `aiInitDone` based on whether the file exists. */
  loadProjectHistory: (workspacePath: string) => Promise<void>;
  /** Best-effort persist the in-memory `aiMessages` array to
   *  `.quebracho/history.json`. Only writes when `.quebracho/` already exists. */
  saveProjectHistory: () => Promise<void>;
  /** Replace `aiMessages` with the loaded array (no IPC). */
  setAIMessages: (messages: AIMessage[]) => void;

  // Agent → editor streaming (real-time code writes)
  /** Set of absolute file paths currently being streamed by the agent.
   *  The Monaco editor consults this set inside its `onChange` handler so
   *  external value updates (driven by `agentStreamAppendTab`) do NOT
   *  trigger a feedback loop that reverts the streamed content back to the
   *  previous in-editor value. Populated by `agentStreamOpenTab` and
   *  cleared by `agentStreamFinalizeTab`. */
  agentStreamingPaths: Set<string>;
  /** Open / activate a tab for the file the agent is about to write,
   *  clearing its content so streamed chunks can be appended live. */
  agentStreamOpenTab: (workspaceRelPath: string) => string | null;
  /** Append decoded content (raw JS string, already unescaped) to the tab
   *  whose path matches `fullPath`. */
  agentStreamAppendTab: (fullPath: string, chunk: string) => void;
  /** After streaming completes, persist the file content to disk. */
  agentStreamFinalizeTab: (fullPath: string) => Promise<void>;
  /** Add / update a live-write entry on the given assistant message. */
  agentLiveWriteUpdate: (
    messageId: string,
    ruta: string,
    patch: Partial<LiveWrite>,
  ) => void;

  // Actions
  openFolder: (folderPath?: string) => Promise<void>;
  openFilePath: (filePath?: string) => Promise<void>;
  refreshFileTree: () => Promise<void>;
  /** Subscribe to file system change events from the workspace watcher.
   *  Re-fetches the file tree on every notification (debounced upstream
   *  in the main process). Returns an unsubscribe function. */
  subscribeToFsChanges: () => () => void;
  toggleFolder: (folderId: string) => void;
  expandFolder: (folderId: string) => void;
  openFile: (node: TreeNode) => Promise<void>;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  saveFile: (tabId?: string) => Promise<void>;
  saveAllFiles: () => Promise<void>;
  closeWorkspace: () => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  toggleActivityBar: () => void;
  toggleStatusBar: () => void;
  setSidebarPanel: (panel: SidebarPanel) => void;
  setBottomTab: (tab: BottomTab) => void;
  setSidebarWidth: (width: number) => void;
  setBottomPanelHeight: (height: number) => void;
  setActiveTerminalId: (id: string | null) => void;
  /** Send `cd "<path>"` (newline-appended) to the currently-active pty. */
  sendCdToActiveTerminal: (workspacePath: string) => void;
  setCursorPosition: (pos: CursorPosition) => void;
  setHasTextSelection: (hasSelection: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  initializeLanguage: () => Promise<void>;
  initializeTerminalShell: () => Promise<void>;
  initializeColorTheme: () => Promise<void>;
  initializeFileIconTheme: () => Promise<void>;
  setUILanguage: (language: UILanguage) => Promise<void>;
  setTerminalShellPreference: (shell: string) => Promise<void>;
  setColorTheme: (theme: ColorThemeId) => Promise<void>;
  setFileIconTheme: (theme: FileIconThemeId) => Promise<void>;
  setSettingsModalOpen: (open: boolean) => void;
  setSelectedPath: (selection: SelectedNode | null) => void;

  // ── Live Server actions ─────────────────────────────────────────────
  /** Boot the live server with the given HTML file (or its parent folder).
   *  If a server is already running it is restarted on the new file. */
  startLiveServer: (htmlPath: string) => Promise<void>;
  /** Stop the running live server, no-op if not active. */
  stopLiveServer: () => Promise<void>;
  /** Toggle the server using the currently-active HTML file as fallback. */
  toggleLiveServer: (htmlPath?: string) => Promise<void>;
  /** Refresh live-server state from the main process (called on startup). */
  refreshLiveServerStatus: () => Promise<void>;
  /** Internal: applied by the main-process status push channel. */
  _setLiveServerStatus: (payload: {
    active: boolean;
    port: number | null;
    root: string | null;
    htmlFile: string | null;
    url: string | null;
  }) => void;

  /** Resolve the directory in which a new item should be created based on the
   *  current sidebar selection. */
  resolveCreateParent: () => string | null;
  createNewFile: (parentPath: string, fileName: string) => Promise<void>;
  createNewDirectory: (parentPath: string, dirName: string) => Promise<void>;
  deleteItem: (itemPath: string) => Promise<void>;
  renameItem: (oldPath: string, newName: string) => Promise<void>;
}

function joinPath(parent: string, name: string): string {
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return parent.endsWith(sep) ? `${parent}${name}` : `${parent}${sep}${name}`;
}

function dirname(p: string): string {
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/';
  const idx = p.lastIndexOf(sep);
  return idx === -1 ? p : p.substring(0, idx);
}

export const useStore = create<EditorState>((set, get) => ({
  // Initial state
  workspacePath: null,
  workspaceName: null,
  fileTree: [],
  expandedFolders: new Set<string>(),
  selectedPath: null,
  selectedKind: null,
  openTabs: [],
  activeTabId: null,
  sidebarVisible: true,
  bottomPanelVisible: false,
  activityBarVisible: true,
  statusBarVisible: true,
  activeSidebarPanel: 'explorer',
  activeBottomTab: 'terminal',
  sidebarWidth: 250,
  bottomPanelHeight: 260,
  activeTerminalId: null,
  cursorPosition: { line: 1, column: 1 },
  hasTextSelection: false,
  commandPaletteOpen: false,
  uiLanguage: getInitialLanguage(),
  terminalShellPreference: 'auto',
  colorTheme: DEFAULT_COLOR_THEME,
  fileIconTheme: DEFAULT_FILE_ICON_THEME,
  settingsModalOpen: false,

  // Live server initial state
  liveServerActive: false,
  liveServerPort: null,
  liveServerRoot: null,
  liveServerHtmlFile: null,
  liveServerUrl: null,

  // AI panel initial state
  aiPanelVisible: false,
  aiPanelWidth: 360,
  aiApiKeyModalOpen: false,
  aiConfiguredProviders: [],
  aiActiveProvider: null,
  aiActiveModel: null,
  aiAvailableModels: {},
  aiModelMenuOpen: false,
  aiKeyringStatus: null,
  aiInitDone: false,
  aiMessages: [],
  aiStatus: 'idle',
  aiStatusText: '',
  aiPendingDiff: null,
  aiPendingDiffResolver: null,

  // Agent streaming initial state
  agentStreamingPaths: new Set<string>(),

  // ── AI Panel actions ────────────────────────────────────────────────
  toggleAIPanel: () => {
    set((state) => ({ aiPanelVisible: !state.aiPanelVisible }));
  },
  setAIPanelWidth: (width: number) => {
    const clamped = Math.max(280, Math.min(720, Math.round(width)));
    set({ aiPanelWidth: clamped });
  },
  setAIApiKeyModalOpen: (open: boolean) => set({ aiApiKeyModalOpen: open }),
  refreshAIConfig: async () => {
    try {
      const cfg = await window.forgeAPI.ai.getConfig();
      set({
        aiConfiguredProviders: cfg.configuredProviders,
        aiActiveProvider: cfg.activeProvider,
        aiActiveModel: cfg.activeModel,
        aiKeyringStatus: cfg.keyringStatus ?? null,
      });
    } catch (err) {
      console.warn('[quebracho] refreshAIConfig failed:', (err as Error)?.message);
    }
  },
  setAIAvailableModels: (provider, models) => {
    set((state) => ({
      aiAvailableModels: { ...state.aiAvailableModels, [provider]: models },
    }));
  },
  setAIActive: async (provider, model) => {
    // Optimistic update: write to the in-memory store IMMEDIATELY so the rest
    // of the renderer (TopBar label, runUserPrompt readers, etc.) reflects
    // the new selection on the very next tick. Persistence to disk is
    // best-effort and happens afterwards — even if it fails the current
    // session uses the new model.
    set({ aiActiveProvider: provider, aiActiveModel: model });
    try {
      await window.forgeAPI.ai.setActive(provider, model);
      console.debug('[quebracho] setAIActive persisted:', provider, model);
    } catch (err) {
      console.warn('[quebracho] setAIActive persist failed:', (err as Error)?.message);
    }
  },
  /** Removes a provider's API key. If that provider was active, clears the
   *  active provider/model selection. Refreshes the configured-providers list. */
  removeAIProvider: async (provider) => {
    try {
      await window.forgeAPI.ai.removeApiKey(provider);
    } catch (err) {
      console.warn('[quebracho] removeAIProvider failed:', (err as Error)?.message);
    }
    set((state) => {
      const wasActive = state.aiActiveProvider === provider;
      const nextAvailable = { ...state.aiAvailableModels };
      delete nextAvailable[provider];
      return {
        aiConfiguredProviders: state.aiConfiguredProviders.filter((p) => p !== provider),
        aiActiveProvider: wasActive ? null : state.aiActiveProvider,
        aiActiveModel: wasActive ? null : state.aiActiveModel,
        aiAvailableModels: nextAvailable,
      };
    });
    // Persist the cleared active selection if needed.
    const s = get();
    if (s.aiActiveProvider === null) {
      try {
        await window.forgeAPI.ai.setActive('' as ProviderId, '');
      } catch {
        /* best-effort */
      }
    }
  },
  setAIModelMenuOpen: (open: boolean) => set({ aiModelMenuOpen: open }),
  addAIMessage: (msg) => {
    set((state) => ({ aiMessages: [...state.aiMessages, msg] }));
  },
  updateAIMessage: (id, patch) => {
    set((state) => ({
      aiMessages: state.aiMessages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  },
  appendToAIMessage: (id, text) => {
    set((state) => ({
      aiMessages: state.aiMessages.map((m) =>
        m.id === id ? { ...m, content: m.content + text } : m,
      ),
    }));
  },
  clearAIConversation: () => {
    set({
      aiMessages: [],
      aiStatus: 'idle',
      aiStatusText: '',
      aiPendingDiff: null,
      aiPendingDiffResolver: null,
    });
  },
  setAIStatus: (status, text) => {
    set({ aiStatus: status, aiStatusText: text ?? '' });
  },
  setAIInitDone: (done) => set({ aiInitDone: done }),
  setAIPendingDiff: (diff, resolver) => {
    set({ aiPendingDiff: diff, aiPendingDiffResolver: resolver ?? null });
  },
  setAIMessages: (messages) => set({ aiMessages: messages }),

  /** Load `.quebracho/history.json` from disk for the given workspace.
   *  Replaces aiMessages and toggles `aiInitDone` based on file existence. */
  loadProjectHistory: async (workspacePath) => {
    if (!workspacePath || !window.forgeAPI?.quebracho) {
      set({ aiMessages: [], aiInitDone: false });
      return;
    }
    try {
      const history = await window.forgeAPI.quebracho.readHistory(workspacePath);
      if (history === null) {
        // history.json does not exist → /init has not been run yet.
        set({
          aiMessages: [],
          aiInitDone: false,
          aiStatus: 'idle',
          aiStatusText: '',
          aiPendingDiff: null,
          aiPendingDiffResolver: null,
        });
        return;
      }
      // Sanitise: never restore a stale "streaming" flag on assistant
      // messages and drop any in-flight `liveWrites`. They cannot resume
      // across runs and would otherwise leak a stuck UI state.
      const safe = (Array.isArray(history) ? history : []).map((m: AIMessage) => ({
        ...m,
        streaming: false,
        liveWrites: m.liveWrites?.map((w) => ({ ...w, done: true })) ?? undefined,
      }));
      set({
        aiMessages: safe,
        aiInitDone: true,
        aiStatus: 'idle',
        aiStatusText: '',
        aiPendingDiff: null,
        aiPendingDiffResolver: null,
      });
    } catch (err) {
      console.warn('[quebracho] loadProjectHistory failed:', (err as Error)?.message);
      set({ aiMessages: [], aiInitDone: false });
    }
  },

  saveProjectHistory: async () => {
    const { workspacePath, aiMessages, aiInitDone } = get();
    if (!workspacePath || !window.forgeAPI?.quebracho) return;
    // Don't write history for projects that haven't been /init-ed yet, to
    // avoid creating `.quebracho/` implicitly when the user is just exploring.
    if (!aiInitDone) return;
    try {
      await window.forgeAPI.quebracho.writeHistory(workspacePath, aiMessages);
    } catch (err) {
      console.debug('[quebracho] saveProjectHistory failed:', (err as Error)?.message);
    }
  },

  // ── Agent → editor streaming ─────────────────────────────────────────
  agentStreamOpenTab: (workspaceRelPath: string) => {
    const { workspacePath, openTabs } = get();
    if (!workspacePath || !workspaceRelPath) return null;

    // Resolve the absolute path. The agent may pass either a relative path
    // or an absolute one inside the workspace.
    const sep = workspacePath.includes('\\') && !workspacePath.includes('/') ? '\\' : '/';
    const isAbs =
      workspaceRelPath.startsWith('/') ||
      /^[a-zA-Z]:[\\/]/.test(workspaceRelPath);
    const fullPath = isAbs
      ? workspaceRelPath
      : (workspacePath.endsWith(sep)
          ? workspacePath + workspaceRelPath
          : workspacePath + sep + workspaceRelPath
        ).replace(/[\\/]+/g, sep);

    const name = fullPath.split(/[\\/]/).pop() || fullPath;
    const language = getLanguageFromPath(fullPath);
    const existing = openTabs.find((t) => t.path === fullPath);

    if (existing) {
      // Reset content to '' so the streaming write feels like "typing into"
      // an empty buffer rather than appending after the old contents.
      //
      // ALSO mark `fullPath` as "currently streaming" so that the Monaco
      // editor's `onChange` callback ignores the change events that fire
      // while the agent rewrites the buffer programmatically. Without this
      // guard, Monaco's onChange races the next `agentStreamAppendTab`
      // `set()` and reverts `tab.content` back to a stale snapshot,
      // ultimately causing `agentStreamFinalizeTab` to persist OLD content.
      set((state) => {
        const nextStreaming = new Set(state.agentStreamingPaths);
        nextStreaming.add(fullPath);
        return {
          openTabs: state.openTabs.map((t) =>
            t.id === existing.id
              ? { ...t, content: '', isUnsaved: true, language }
              : t,
          ),
          activeTabId: existing.id,
          selectedPath: fullPath,
          selectedKind: 'file',
          agentStreamingPaths: nextStreaming,
        };
      });
      return fullPath;
    }

    const newTab: Tab = {
      id: fullPath,
      name,
      path: fullPath,
      content: '',
      savedContent: '',
      language,
      isUnsaved: true,
    };
    set((state) => {
      const nextStreaming = new Set(state.agentStreamingPaths);
      nextStreaming.add(fullPath);
      return {
        openTabs: [...state.openTabs, newTab],
        activeTabId: newTab.id,
        selectedPath: fullPath,
        selectedKind: 'file',
        agentStreamingPaths: nextStreaming,
      };
    });
    return fullPath;
  },

  agentStreamAppendTab: (fullPath, chunk) => {
    if (!chunk) return;
    set((state) => ({
      openTabs: state.openTabs.map((t) =>
        t.id === fullPath || t.path === fullPath
          ? { ...t, content: t.content + chunk, isUnsaved: true }
          : t,
      ),
    }));
  },

  agentStreamFinalizeTab: async (fullPath) => {
    const tab = get().openTabs.find((t) => t.id === fullPath || t.path === fullPath);
    if (!tab) {
      console.warn('[quebracho] agentStreamFinalizeTab: no tab matches', fullPath);
      // Still clear the streaming flag for this path so a future open of
      // the file isn't blocked by stale state.
      set((state) => {
        if (!state.agentStreamingPaths.has(fullPath)) return state;
        const nextStreaming = new Set(state.agentStreamingPaths);
        nextStreaming.delete(fullPath);
        return { agentStreamingPaths: nextStreaming };
      });
      return;
    }
    try {
      // Snapshot the streamed content BEFORE awaiting the disk write. If
      // Monaco somehow fires a reverting `onChange` between now and the
      // post-await `set()` (despite the `agentStreamingPaths` guard), we
      // still persist the right value to `savedContent` so the tab does
      // not show as "dirty" with stale content.
      const streamedContent = tab.content;
      await window.forgeAPI.writeFile(tab.path, streamedContent);
      set((state) => {
        const nextStreaming = new Set(state.agentStreamingPaths);
        nextStreaming.delete(fullPath);
        nextStreaming.delete(tab.path);
        nextStreaming.delete(tab.id);
        return {
          openTabs: state.openTabs.map((t) =>
            t.id === tab.id
              ? {
                  ...t,
                  // Force the tab content back to the streamed snapshot to
                  // overwrite any stale onChange that may have slipped in.
                  content: streamedContent,
                  savedContent: streamedContent,
                  isUnsaved: false,
                }
              : t,
          ),
          agentStreamingPaths: nextStreaming,
        };
      });
    } catch (err) {
      // Surface the failure loudly — silent failures here are the reason
      // streamed files used to appear in tabs but never land on disk.
      const msg = (err as Error)?.message || String(err);
      console.error('[quebracho] agentStreamFinalizeTab failed:', tab.path, msg);
      // Always clear the streaming flag, even on failure, so the editor
      // returns to normal interactive editing.
      set((state) => {
        const nextStreaming = new Set(state.agentStreamingPaths);
        nextStreaming.delete(fullPath);
        nextStreaming.delete(tab.path);
        nextStreaming.delete(tab.id);
        return { agentStreamingPaths: nextStreaming };
      });
      try {
        get().setAIStatus('idle', t(get().uiLanguage, 'aiPanel.runtimeSaveError', {
          file: tab.name,
          error: msg,
        }));
      } catch {
        /* setAIStatus might not exist in some test paths; ignore */
      }
    }
  },

  agentLiveWriteUpdate: (messageId, ruta, patch) => {
    set((state) => ({
      aiMessages: state.aiMessages.map((m) => {
        if (m.id !== messageId) return m;
        const prev = m.liveWrites ?? [];
        const idx = prev.findIndex((w) => w.ruta === ruta);
        if (idx === -1) {
          return {
            ...m,
            liveWrites: [...prev, { ruta, done: false, ...patch }],
          };
        }
        const next = prev.slice();
        next[idx] = { ...next[idx], ...patch };
        return { ...m, liveWrites: next };
      }),
    }));
  },

  // ── Actions ──────────────────────────────────────────────────────────

  openFolder: async (folderPath?: string) => {
    try {
      // Defensive: this action is sometimes wired directly into onClick
      // handlers (e.g. <button onClick={openFolder} />), which would pass a
      // React SyntheticEvent as `folderPath`. That non-serializable object
      // cannot be cloned through backend IPC and triggers the
      // "An object could not be cloned" error in the renderer. Coerce
      // non-string values to undefined so we fall back to the file dialog.
      const safeFolderPath = typeof folderPath === 'string' ? folderPath : undefined;

      const resolvedFolderPath =
        safeFolderPath ?? (await window.forgeAPI.openFolder());
      if (!resolvedFolderPath || typeof resolvedFolderPath !== 'string') return;

      // Before switching, persist the outgoing project's conversation so
      // we don't lose any unsaved AI messages.
      try {
        await get().saveProjectHistory();
      } catch (err) {
        console.debug(
          '[quebracho] saveProjectHistory before switch failed:',
          (err as Error)?.message,
        );
      }

      const tree = await window.forgeAPI.readDirectory(resolvedFolderPath);
      // Use a regex that handles both forward and back slashes (Windows paths
      // with only backslashes were previously returning the whole path here).
      const segments = resolvedFolderPath.split(/[\\/]/).filter(Boolean);
      const name = segments.length > 0 ? segments[segments.length - 1] : resolvedFolderPath;

      set({
        workspacePath: resolvedFolderPath,
        workspaceName: name,
        fileTree: Array.isArray(tree) ? tree : [],
        expandedFolders: new Set<string>(),
        selectedPath: null,
        selectedKind: null,
        openTabs: [],
        activeTabId: null,
        // Reset AI panel state — the loader below will rehydrate it.
        aiMessages: [],
        aiInitDone: false,
        aiStatus: 'idle',
        aiStatusText: '',
        aiPendingDiff: null,
        aiPendingDiffResolver: null,
      });

      // Start (or restart) the workspace file system watcher so external
      // changes (made from the OS file explorer, terminal, etc.) refresh
      // the sidebar tree automatically. The main process tears down any
      // previous watcher when a new path is supplied.
      try {
        await window.forgeAPI.watchWorkspace(resolvedFolderPath);
      } catch (err) {
        console.error('Failed to start workspace watcher:', err);
      }

      // Spawn typescript-language-server for the new workspace. The LSP
      // client handles restarts (stops the previous server first) and
      // gracefully degrades if the binary isn't installed.
      try {
        await lspClient.startWorkspace(resolvedFolderPath);
      } catch (err) {
        console.debug(
          '[quebracho] LSP start skipped:',
          (err as Error)?.message
        );
      }

      // Load per-project conversation history from `.quebracho/history.json`.
      // If the file is missing, `aiInitDone` stays false (the panel will
      // prompt the user to run `/init`).
      try {
        await get().loadProjectHistory(resolvedFolderPath);
      } catch (err) {
        console.debug(
          '[quebracho] loadProjectHistory in openFolder failed:',
          (err as Error)?.message,
        );
      }

      // If there's already a live terminal, cd into the new workspace so
      // the user doesn't have to do it manually. We schedule it on a small
      // timeout to give any newly-attached terminal a chance to register
      // its id with the store first.
      try {
        get().sendCdToActiveTerminal(resolvedFolderPath);
      } catch (err) {
        console.debug('[quebracho] cd-to-workspace skipped:', (err as Error)?.message);
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  },

  openFilePath: async (filePath?: string) => {
    try {
      const resolvedPath =
        typeof filePath === 'string'
          ? filePath
          : await window.forgeAPI.openFile();
      if (!resolvedPath || typeof resolvedPath !== 'string') return;

      const { openTabs } = get();
      const existingTab = openTabs.find((t) => t.path === resolvedPath);
      if (existingTab) {
        set({
          activeTabId: existingTab.id,
          selectedPath: resolvedPath,
          selectedKind: 'file',
        });
        return;
      }

      const content = await window.forgeAPI.readFile(resolvedPath);
      const language = getLanguageFromPath(resolvedPath);
      const name = resolvedPath.split('/').pop() || resolvedPath.split('\\').pop() || resolvedPath;

      const newTab: Tab = {
        id: resolvedPath,
        name,
        path: resolvedPath,
        content,
        savedContent: content,
        language,
        isUnsaved: false,
      };

      set((state) => ({
        openTabs: [...state.openTabs, newTab],
        activeTabId: newTab.id,
        selectedPath: resolvedPath,
        selectedKind: 'file',
      }));
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  },

  refreshFileTree: async () => {
    const { workspacePath } = get();
    if (!workspacePath) return;

    try {
      const tree = await window.forgeAPI.readDirectory(workspacePath);
      set({ fileTree: tree });
    } catch (err) {
      console.error('Failed to refresh file tree:', err);
    }
  },

  subscribeToFsChanges: () => {
    // Coalesce many incoming events into a single re-fetch. The main process
    // already debounces, but a second guard on the renderer side is cheap and
    // protects us from rapid-fire bursts caused by editors that write files
    // in multiple steps (truncate → write → fsync).
    let pending: number | null = null;
    let stopped = false;

    const handler = (_event: FsChangeEvent) => {
      if (stopped) return;
      if (pending !== null) return;
      pending = window.setTimeout(() => {
        pending = null;
        // Use the latest workspace path at fire time.
        get().refreshFileTree();
      }, 60);
    };

    if (window.forgeAPI?.onFsChanged) {
      window.forgeAPI.onFsChanged(handler);
    }

    return () => {
      stopped = true;
      if (pending !== null) {
        window.clearTimeout(pending);
        pending = null;
      }
      if (window.forgeAPI?.offFsChanged) {
        window.forgeAPI.offFsChanged(handler);
      }
    };
  },

  toggleFolder: (folderId: string) => {
    set((state) => {
      const next = new Set(state.expandedFolders);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return { expandedFolders: next };
    });
  },

  expandFolder: (folderId: string) => {
    set((state) => {
      if (state.expandedFolders.has(folderId)) return {};
      const next = new Set(state.expandedFolders);
      next.add(folderId);
      return { expandedFolders: next };
    });
  },

  openFile: async (node: TreeNode) => {
    if (node.type !== 'file') return;

    const { openTabs } = get();
    const existingTab = openTabs.find((t) => t.path === node.path);

    if (existingTab) {
      set({
        activeTabId: existingTab.id,
        selectedPath: node.path,
        selectedKind: 'file',
      });
      return;
    }

    try {
      // Image files (png/jpg/jpeg/gif/webp/bmp/ico/svg) are opened as
      // image-preview tabs rather than text editors. Reading the bytes as a
      // utf-8 string would produce garbage for binary formats and break
      // SVGs that contain non-utf-8 binary attachments. We ship a base64
      // data URL to the renderer instead so <img> can decode it natively.
      if (isImageFile(node.path)) {
        const { dataUrl, size } = await window.forgeAPI.readImageDataUrl(node.path);
        const newTab: Tab = {
          id: node.path,
          name: node.name,
          path: node.path,
          // Empty content — the image is rendered from `imageDataUrl`.
          content: '',
          savedContent: '',
          // Use 'image' as a sentinel value so the UI can opt-out of LSP /
          // Monaco wiring for these tabs.
          language: 'image',
          isUnsaved: false,
          imageDataUrl: dataUrl,
          fileSize: size,
        };

        set((state) => ({
          openTabs: [...state.openTabs, newTab],
          activeTabId: newTab.id,
          selectedPath: node.path,
          selectedKind: 'file',
        }));
        return;
      }

      const content = await window.forgeAPI.readFile(node.path);
      const language = getLanguageFromPath(node.path);

      const newTab: Tab = {
        id: node.path,
        name: node.name,
        path: node.path,
        content,
        savedContent: content,
        language,
        isUnsaved: false,
      };

      set((state) => ({
        openTabs: [...state.openTabs, newTab],
        activeTabId: newTab.id,
        selectedPath: node.path,
        selectedKind: 'file',
      }));
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  },

  closeTab: (tabId: string) => {
    set((state) => {
      const idx = state.openTabs.findIndex((t) => t.id === tabId);
      const newTabs = state.openTabs.filter((t) => t.id !== tabId);
      let newActiveId = state.activeTabId;

      if (state.activeTabId === tabId) {
        if (newTabs.length === 0) {
          newActiveId = null;
        } else if (idx >= newTabs.length) {
          newActiveId = newTabs[newTabs.length - 1].id;
        } else {
          newActiveId = newTabs[idx].id;
        }
      }

      return { openTabs: newTabs, activeTabId: newActiveId };
    });
  },

  setActiveTab: (tabId: string) => {
    // Switching tabs also moves the sidebar selection to the active file so
    // the folder-highlight chain follows the active editor.
    const tab = get().openTabs.find((t) => t.id === tabId);
    set({
      activeTabId: tabId,
      ...(tab ? { selectedPath: tab.path, selectedKind: 'file' as SelectedNodeKind } : {}),
    });
  },

  updateTabContent: (tabId: string, content: string) => {
    set((state) => ({
      openTabs: state.openTabs.map((t) =>
        t.id === tabId
          ? { ...t, content, isUnsaved: content !== t.savedContent }
          : t
      ),
    }));
  },

  saveFile: async (tabId?: string) => {
    const state = get();
    const id = tabId || state.activeTabId;
    if (!id) return;

    const tab = state.openTabs.find((t) => t.id === id);
    if (!tab) return;

    try {
      await window.forgeAPI.writeFile(tab.path, tab.content);
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.id === id
            ? { ...t, savedContent: t.content, isUnsaved: false }
            : t
        ),
      }));
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  },

  saveAllFiles: async () => {
    const { openTabs } = get();
    const dirtyTabs = openTabs.filter((tab) => tab.isUnsaved && !tab.imageDataUrl);
    if (dirtyTabs.length === 0) return;

    await Promise.all(
      dirtyTabs.map(async (tab) => {
        try {
          await window.forgeAPI.writeFile(tab.path, tab.content);
          set((state) => ({
            openTabs: state.openTabs.map((t) =>
              t.id === tab.id
                ? { ...t, savedContent: t.content, isUnsaved: false }
                : t,
            ),
          }));
        } catch (err) {
          console.error(`Failed to save file ${tab.path}:`, err);
        }
      }),
    );
  },

  closeWorkspace: () => {
    // Best-effort: persist the outgoing project's history before clearing
    // it from memory. Fire-and-forget so closing remains synchronous.
    try {
      void get().saveProjectHistory();
    } catch {
      /* best-effort; ignore */
    }

    // Tear down the workspace: clear the path, file tree, expanded folders,
    // sidebar selection and all open editor tabs. Also stop any active file
    // system watcher in the main process if the API is available.
    try {
      const stopWatcher = (window as unknown as {
        forgeAPI?: { stopWatcher?: () => Promise<void> | void };
      }).forgeAPI?.stopWatcher;
      if (typeof stopWatcher === 'function') {
        Promise.resolve(stopWatcher()).catch(() => {
          /* best-effort; ignore */
        });
      }
    } catch {
      /* best-effort; ignore */
    }

    // Stop the language server tied to this workspace. Fire-and-forget;
    // the LSP client clears markers and document tracking eagerly.
    try {
      void lspClient.stopWorkspace().catch(() => undefined);
    } catch {
      /* best-effort; ignore */
    }

    set({
      workspacePath: null,
      workspaceName: null,
      fileTree: [],
      expandedFolders: new Set<string>(),
      selectedPath: null,
      selectedKind: null,
      openTabs: [],
      activeTabId: null,
      // Reset AI conversation when a workspace closes.
      aiInitDone: false,
      aiMessages: [],
      aiStatus: 'idle',
      aiStatusText: '',
      aiPendingDiff: null,
      aiPendingDiffResolver: null,
    });
  },

  toggleSidebar: () => {
    set((state) => ({ sidebarVisible: !state.sidebarVisible }));
  },

  togglePanel: () => {
    set((state) => ({ bottomPanelVisible: !state.bottomPanelVisible }));
  },

  toggleActivityBar: () => {
    set((state) => ({ activityBarVisible: !state.activityBarVisible }));
  },

  toggleStatusBar: () => {
    set((state) => ({ statusBarVisible: !state.statusBarVisible }));
  },

  setSidebarPanel: (panel: SidebarPanel) => {
    set((state) => {
      if (state.activeSidebarPanel === panel && state.sidebarVisible) {
        return { sidebarVisible: false };
      }
      return { activeSidebarPanel: panel, sidebarVisible: true };
    });
  },

  setBottomTab: (tab: BottomTab) => {
    set({ activeBottomTab: tab, bottomPanelVisible: true });
  },

  setSidebarWidth: (width: number) => {
    // Clamp to sane bounds matching the divider behaviour in App.tsx.
    const clamped = Math.max(150, Math.min(500, Math.round(width)));
    set({ sidebarWidth: clamped });
  },

  setBottomPanelHeight: (height: number) => {
    // App.tsx is responsible for clamping against the available viewport
    // height (it knows the dynamic max). We just round to integer pixels.
    set({ bottomPanelHeight: Math.max(100, Math.round(height)) });
  },

  setActiveTerminalId: (id: string | null) => {
    set({ activeTerminalId: id });
  },

  sendCdToActiveTerminal: (workspacePath: string) => {
    if (!workspacePath) return;
    const { activeTerminalId } = get();
    if (!activeTerminalId) return;
    if (!window.forgeAPI?.terminalWrite) return;

    // Quote the path to handle spaces, and rely on `cd` to expand
    // backslashes correctly on Windows (PowerShell + cmd both accept
    // quoted paths).
    const escaped = workspacePath.replace(/"/g, '\\"');
    const command = ` cd "${escaped}"\r`; // leading space helps bash HISTCONTROL=ignorespace
    try {
      window.forgeAPI.terminalWrite(activeTerminalId, command);
    } catch (err) {
      console.debug('[quebracho] terminalWrite (cd) failed:', (err as Error)?.message);
    }
  },

  setCursorPosition: (pos: CursorPosition) => {
    set({ cursorPosition: pos });
  },

  setHasTextSelection: (hasSelection: boolean) => {
    set({ hasTextSelection: hasSelection });
  },

  setCommandPaletteOpen: (open: boolean) => {
    set({ commandPaletteOpen: open });
  },

  initializeLanguage: async () => {
    const local = get().uiLanguage;
    try {
      const fromConfig = await window.forgeAPI.settings.getLanguage();
      if (fromConfig) {
        const normalized = normalizeLanguage(fromConfig);
        persistLanguage(normalized);
        set({ uiLanguage: normalized });
        return;
      }
      set({ uiLanguage: local });
    } catch {
      set({ uiLanguage: local });
    }
  },

  initializeTerminalShell: async () => {
    try {
      const fromConfig = await window.forgeAPI.settings.getTerminalShell();
      set({ terminalShellPreference: fromConfig && fromConfig.trim() ? fromConfig : 'auto' });
    } catch {
      set({ terminalShellPreference: 'auto' });
    }
  },

  initializeColorTheme: async () => {
    try {
      const fromConfig = await window.forgeAPI.settings.getColorTheme();
      set({ colorTheme: normalizeColorTheme(fromConfig) });
    } catch {
      set({ colorTheme: DEFAULT_COLOR_THEME });
    }
  },

  initializeFileIconTheme: async () => {
    try {
      const fromConfig = await window.forgeAPI.settings.getFileIconTheme();
      set({ fileIconTheme: normalizeFileIconTheme(fromConfig) });
    } catch {
      set({ fileIconTheme: DEFAULT_FILE_ICON_THEME });
    }
  },

  setUILanguage: async (language: UILanguage) => {
    const normalized = normalizeLanguage(language);
    persistLanguage(normalized);
    set({ uiLanguage: normalized });
    try {
      await window.forgeAPI.settings.setLanguage(normalized);
    } catch (err) {
      console.warn('[quebracho] setUILanguage persist failed:', (err as Error)?.message);
    }
  },

  setTerminalShellPreference: async (shell: string) => {
    const normalized = shell && shell.trim() ? shell.trim() : 'auto';
    set({ terminalShellPreference: normalized });
    try {
      await window.forgeAPI.settings.setTerminalShell(normalized === 'auto' ? null : normalized);
    } catch (err) {
      console.warn('[quebracho] setTerminalShellPreference persist failed:', (err as Error)?.message);
    }
  },

  setColorTheme: async (theme: ColorThemeId) => {
    const normalized = normalizeColorTheme(theme);
    set({ colorTheme: normalized });
    try {
      await window.forgeAPI.settings.setColorTheme(normalized);
    } catch (err) {
      console.warn('[quebracho] setColorTheme persist failed:', (err as Error)?.message);
    }
  },

  setFileIconTheme: async (theme: FileIconThemeId) => {
    const normalized = normalizeFileIconTheme(theme);
    set({ fileIconTheme: normalized });
    try {
      await window.forgeAPI.settings.setFileIconTheme(normalized);
    } catch (err) {
      console.warn('[quebracho] setFileIconTheme persist failed:', (err as Error)?.message);
    }
  },

  setSettingsModalOpen: (open: boolean) => {
    set({ settingsModalOpen: open });
  },

  setSelectedPath: (selection: SelectedNode | null) => {
    if (selection === null) {
      set({ selectedPath: null, selectedKind: null });
    } else {
      set({ selectedPath: selection.path, selectedKind: selection.kind });
    }
  },

  // ── Live Server actions ─────────────────────────────────────────────
  startLiveServer: async (htmlPath: string) => {
    try {
      const status = await window.forgeAPI.liveServer.start(htmlPath);
      set({
        liveServerActive: status.active,
        liveServerPort: status.port,
        liveServerRoot: status.root,
        liveServerHtmlFile: status.htmlFile,
        liveServerUrl: status.url,
      });
    } catch (err) {
      console.error('Failed to start live server:', err);
      // Surface to the user — the underlying port may be busy, etc.
      try {
        alert(`Live Server: ${(err as Error)?.message ?? 'error desconocido'}`);
      } catch {
        /* noop in non-DOM environments */
      }
    }
  },

  stopLiveServer: async () => {
    try {
      await window.forgeAPI.liveServer.stop();
    } catch (err) {
      console.error('Failed to stop live server:', err);
    }
    set({
      liveServerActive: false,
      liveServerPort: null,
      liveServerRoot: null,
      liveServerHtmlFile: null,
      liveServerUrl: null,
    });
  },

  toggleLiveServer: async (htmlPath?: string) => {
    const { liveServerActive } = get();
    if (liveServerActive) {
      await get().stopLiveServer();
      return;
    }
    // Need a path to start. Fall back to the active tab if it's an HTML file.
    let target = htmlPath;
    if (!target) {
      const state = get();
      const activeTab = state.openTabs.find((t) => t.id === state.activeTabId);
      if (
        activeTab &&
        /\.html?$/i.test(activeTab.path)
      ) {
        target = activeTab.path;
      }
    }
    if (!target) {
      console.warn('[quebracho] toggleLiveServer called without an HTML file.');
      return;
    }
    await get().startLiveServer(target);
  },

  refreshLiveServerStatus: async () => {
    try {
      const status = await window.forgeAPI.liveServer.status();
      set({
        liveServerActive: status.active,
        liveServerPort: status.port,
        liveServerRoot: status.root,
        liveServerHtmlFile: status.htmlFile,
        liveServerUrl: status.url,
      });
    } catch (err) {
      console.debug(
        '[quebracho] refreshLiveServerStatus failed:',
        (err as Error)?.message,
      );
    }
  },

  _setLiveServerStatus: (payload) => {
    set({
      liveServerActive: payload.active,
      liveServerPort: payload.port,
      liveServerRoot: payload.root,
      liveServerHtmlFile: payload.htmlFile,
      liveServerUrl: payload.url,
    });
  },

  /** Smart "+" target resolution.
   *
   *  - Nothing selected → workspace root.
   *  - Folder selected → that folder.
   *  - File selected → the file's parent folder.
   *
   *  Returns null when there is no workspace open. */
  resolveCreateParent: () => {
    const { workspacePath, selectedPath, selectedKind } = get();
    if (!workspacePath) return null;
    if (!selectedPath || !selectedKind) return workspacePath;
    if (selectedKind === 'directory') return selectedPath;
    // file selected → use its parent directory
    return dirname(selectedPath) || workspacePath;
  },

  createNewFile: async (parentPath: string, fileName: string) => {
    const fullPath = joinPath(parentPath, fileName);
    try {
      await window.forgeAPI.createFile(fullPath);
      await get().refreshFileTree();
    } catch (err) {
      console.error('Failed to create file:', err);
    }
  },

  createNewDirectory: async (parentPath: string, dirName: string) => {
    const fullPath = joinPath(parentPath, dirName);
    try {
      await window.forgeAPI.createDirectory(fullPath);
      await get().refreshFileTree();
    } catch (err) {
      console.error('Failed to create directory:', err);
    }
  },

  deleteItem: async (itemPath: string) => {
    try {
      await window.forgeAPI.deleteItem(itemPath);
      set((state) => {
        const newTabs = state.openTabs.filter((t) => !t.path.startsWith(itemPath));
        let newActiveId = state.activeTabId;
        if (state.activeTabId && !newTabs.find((t) => t.id === state.activeTabId)) {
          newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
        }
        const clearedSelection =
          state.selectedPath &&
          (state.selectedPath === itemPath ||
            state.selectedPath.startsWith(itemPath + '/') ||
            state.selectedPath.startsWith(itemPath + '\\'));
        return {
          openTabs: newTabs,
          activeTabId: newActiveId,
          ...(clearedSelection
            ? { selectedPath: null, selectedKind: null }
            : {}),
        };
      });
      await get().refreshFileTree();
    } catch (err) {
      console.error('Failed to delete item:', err);
    }
  },

  renameItem: async (oldPath: string, newName: string) => {
    const newPath = joinPath(dirname(oldPath), newName);
    try {
      await window.forgeAPI.renameItem(oldPath, newPath);
      set((state) => {
        let newSelectedPath = state.selectedPath;
        if (state.selectedPath === oldPath) {
          newSelectedPath = newPath;
        } else if (
          state.selectedPath &&
          (state.selectedPath.startsWith(oldPath + '/') ||
            state.selectedPath.startsWith(oldPath + '\\'))
        ) {
          newSelectedPath = newPath + state.selectedPath.substring(oldPath.length);
        }
        return {
          openTabs: state.openTabs.map((t) => {
            if (t.path === oldPath) {
              return { ...t, id: newPath, path: newPath, name: newName };
            }
            if (t.path.startsWith(oldPath + '/') || t.path.startsWith(oldPath + '\\')) {
              const rest = t.path.substring(oldPath.length);
              const np = newPath + rest;
              return { ...t, id: np, path: np };
            }
            return t;
          }),
          activeTabId: state.activeTabId === oldPath ? newPath : state.activeTabId,
          selectedPath: newSelectedPath,
        };
      });
      await get().refreshFileTree();
    } catch (err) {
      console.error('Failed to rename:', err);
    }
  },
}));
