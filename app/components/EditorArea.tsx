import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import { useStore } from '../store';
import { X } from 'lucide-react';
import type { editor } from 'monaco-editor';
import logoUrl from '../assets/quebracho-logo.png';
import { lspClient, getLspLanguageId } from '../lsp/client';
import ImageViewer from './ImageViewer';
import DbQueryEditor from './DbQueryEditor';
import FindReplaceOverlay from './FindReplaceOverlay';
import { t } from '../i18n';
import { defineMonacoThemes, getMonacoThemeName } from '../theme/appearance';

type EditorMenuCommand =
  | 'copy'
  | 'paste'
  | 'cut'
  | 'select-all'
  | 'to-upper'
  | 'to-lower'
  | 'to-snake'
  | 'to-camel'
  | 'to-kebab'
  | 'to-pascal';

function splitWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function toSnakeCase(input: string): string {
  return splitWords(input).map((w) => w.toLowerCase()).join('_');
}

function toKebabCase(input: string): string {
  return splitWords(input).map((w) => w.toLowerCase()).join('-');
}

function toCamelCase(input: string): string {
  const words = splitWords(input);
  if (words.length === 0) return input;
  return words
    .map((w, idx) => {
      const lower = w.toLowerCase();
      if (idx === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

function toPascalCase(input: string): string {
  return splitWords(input)
    .map((w) => {
      const lower = w.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

const editorOptions: editor.IStandaloneEditorConstructionOptions = {
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
  fontLigatures: true,
  minimap: { enabled: true },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  renderLineHighlight: 'all',
  wordWrap: 'off',
  lineNumbers: 'on',
  glyphMargin: false,
  folding: true,
  bracketPairColorization: { enabled: true },
  automaticLayout: true,
  tabSize: 2,
  padding: { top: 8 },
  suggest: {
    showWords: true,
    showSnippets: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Welcome Screen
// ─────────────────────────────────────────────────────────────────────────
function WelcomeScreen() {
  const openFolder = useStore((s) => s.openFolder);
  const uiLanguage = useStore((s) => s.uiLanguage);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-quebracho-editor gap-6 select-none">
      <img src={logoUrl} alt="Quebracho" className="w-[88px] h-[88px] object-contain opacity-60" />
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-3xl font-light text-quebracho-text-strong/70 tracking-wide">Quebracho</h1>
        <p className="text-[12px] text-quebracho-text/45">{t(uiLanguage, 'welcome.byline')}</p>
      </div>
      <div className="flex flex-col items-center gap-3 text-sm">
        <p className="text-quebracho-text/50">{t(uiLanguage, 'welcome.start')}</p>
        <button
          onClick={() => openFolder()}
          className="text-quebracho-accent hover:underline cursor-pointer"
        >
          {t(uiLanguage, 'welcome.openFolder')}
        </button>
        <div className="flex flex-col items-center gap-1 mt-4 text-quebracho-text/40 text-xs">
          <p>
            <kbd className="px-1.5 py-0.5 bg-quebracho-input rounded text-quebracho-text/70">Ctrl+Shift+P</kbd>{' '}
            {t(uiLanguage, 'welcome.commandPalette')}
          </p>
          <p>
            <kbd className="px-1.5 py-0.5 bg-quebracho-input rounded text-quebracho-text/70">Ctrl+B</kbd>{' '}
            {t(uiLanguage, 'welcome.toggleSidebar')}
          </p>
          <p>
            <kbd className="px-1.5 py-0.5 bg-quebracho-input rounded text-quebracho-text/70">Ctrl+`</kbd>{' '}
            {t(uiLanguage, 'welcome.toggleTerminal')}
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyWorkspacePlaceholder() {
  const uiLanguage = useStore((s) => s.uiLanguage);

  return (
    <div className="w-full h-full flex items-center justify-center bg-quebracho-editor select-none">
      <div className="pl-6 pr-6 pt-5 pb-5 rounded-md border border-quebracho-border/70 bg-quebracho-sidebar/35 text-center max-w-[460px]">
        <p className="text-[14px] text-quebracho-text-strong/85 mb-2">{t(uiLanguage, 'welcome.workspaceReadyTitle')}</p>
        <p className="text-[12px] text-quebracho-text/60">{t(uiLanguage, 'welcome.workspaceReadyBody')}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Tab Bar — no icons; active text #4ADB94
// ─────────────────────────────────────────────────────────────────────────
function TabBar() {
  const openTabs = useStore((s) => s.openTabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const promptCloseTab = useStore((s) => s.promptCloseTab);

  if (openTabs.length === 0) return null;

  return (
    <div className="h-[35px] bg-quebracho-tabbar flex items-end overflow-x-auto select-none">
      {openTabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`group flex items-center h-[35px] pl-3 pr-3 gap-2 cursor-pointer min-w-0 max-w-[220px] border-r border-black/30 transition-colors
              ${isActive
                ? 'bg-quebracho-tab-active'
                : 'bg-quebracho-tabbar hover:bg-white/[0.03]'}
            `}
          >
            {tab.isUnsaved && (
              <div className="w-1.75 h-1.75 rounded-full bg-quebracho-text/70 shrink-0" />
            )}

            <span
              className={`truncate text-[13px] ${isActive ? 'text-quebracho-accent' : 'text-quebracho-text-tab'}`}
            >
              {tab.name}
            </span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                void promptCloseTab(tab.id);
              }}
              className={`tab-close p-0.5 shrink-0 text-quebracho-text-tab
                ${isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 hover:!opacity-100'}
              `}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Custom Monaco Theme — "quebracho-dark"
// ─────────────────────────────────────────────────────────────────────────
function defineForgeTheme(monaco: typeof import('monaco-editor')) {
  defineMonacoThemes(monaco);
}

// ─────────────────────────────────────────────────────────────────────────
// Monaco Editor Wrapper
// ─────────────────────────────────────────────────────────────────────────
function MonacoWrapper() {
  const openTabs = useStore((s) => s.openTabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const workspacePath = useStore((s) => s.workspacePath);
  const colorTheme = useStore((s) => s.colorTheme);
  const updateTabContent = useStore((s) => s.updateTabContent);
  const setCursorPosition = useStore((s) => s.setCursorPosition);
  const setHasTextSelection = useStore((s) => s.setHasTextSelection);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const previousTabIdRef = useRef<string | null>(null);
  const viewStatesRef = useRef<Map<string, editor.ICodeEditorViewState | null>>(new Map());

  // Track which tab paths we've sent textDocument/didOpen for, so we
  // can fire didOpen exactly once per tab and didClose when the tab
  // disappears.
  const openedTabPathsRef = useRef<Set<string>>(new Set());

  const activeTab = openTabs.find((t) => t.id === activeTabId);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    defineForgeTheme(monaco);

    // ── Disable Monaco's built-in TS/JS semantic diagnostics ──────────
    // Monaco ships a bundled TypeScript service that doesn't know about
    // the user's tsconfig, node_modules or types-installed packages.
    // typescript-language-server (running in the desktop backend)
    // gives us accurate, project-aware diagnostics; we plumb those in
    // via lspClient.applyDiagnostics() instead. Syntax validation is
    // kept ON because Monaco's parser also tokens cheap stuff (mismatched
    // braces, stray characters) we want to highlight regardless.
    try {
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: false,
      });
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: false,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.debug('[quebracho] Monaco TS diagnostics setup skipped:', (err as Error)?.message);
    }

    // Wire the LSP client into Monaco. attachMonaco is idempotent — it
    // registers the providers and the diagnostics listener exactly once.
    try {
      lspClient.attachMonaco(monaco);
    } catch (err) {
      console.warn('[quebracho] LSP attach failed:', (err as Error)?.message);
    }
  }, []);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    editor.focus();

    // Override native find/replace shortcuts so our custom overlay opens instead.
    // We rely on a DOM capture listener on the editor container (see useEffect
    // below) rather than editor.addCommand, because addCommand doesn't reliably
    // win against Monaco's built-in Find widget keybindings.

    editor.onDidChangeCursorPosition((e) => {
      setCursorPosition({
        line: e.position.lineNumber,
        column: e.position.column,
      });
    });

    editor.onDidChangeCursorSelection((e) => {
      const model = editor.getModel();
      if (!model) {
        setHasTextSelection(false);
        return;
      }
      const selectedText = model.getValueInRange(e.selection);
      setHasTextSelection(selectedText.length > 0);
    });
  }, [setCursorPosition, setHasTextSelection]);

  useEffect(() => {
    const onEditorCommand = (event: Event) => {
      const customEvent = event as CustomEvent<{ command?: EditorMenuCommand }>;
      const command = customEvent.detail?.command;
      if (!command) return;

      const ed = editorRef.current;
      if (!ed || !activeTab || activeTab.imageDataUrl) return;

      if (command === 'copy') {
        ed.trigger('titlebar-menu', 'editor.action.clipboardCopyAction', null);
        return;
      }
      if (command === 'paste') {
        ed.trigger('titlebar-menu', 'editor.action.clipboardPasteAction', null);
        return;
      }
      if (command === 'cut') {
        ed.trigger('titlebar-menu', 'editor.action.clipboardCutAction', null);
        return;
      }
      if (command === 'select-all') {
        ed.trigger('titlebar-menu', 'editor.action.selectAll', null);
        return;
      }

      const model = ed.getModel();
      const selection = ed.getSelection();
      if (!model || !selection || selection.isEmpty()) return;

      const selected = model.getValueInRange(selection);
      if (!selected) return;

      let transformed = selected;
      switch (command) {
        case 'to-upper':
          transformed = selected.toUpperCase();
          break;
        case 'to-lower':
          transformed = selected.toLowerCase();
          break;
        case 'to-snake':
          transformed = toSnakeCase(selected);
          break;
        case 'to-camel':
          transformed = toCamelCase(selected);
          break;
        case 'to-kebab':
          transformed = toKebabCase(selected);
          break;
        case 'to-pascal':
          transformed = toPascalCase(selected);
          break;
        default:
          return;
      }

      if (transformed === selected) return;

      ed.pushUndoStop();
      ed.executeEdits('titlebar-menu', [{ range: selection, text: transformed }]);
      ed.pushUndoStop();
    };

    window.addEventListener('quebracho:editor-command', onEditorCommand);
    return () => window.removeEventListener('quebracho:editor-command', onEditorCommand);
  }, [activeTab]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (activeTabId && value !== undefined) {
        const tab = activeTab;
        // Image tabs are read-only previews; ignore any spurious change
        // event Monaco might fire while we're mounted alongside them.
        if (tab?.imageDataUrl) return;

        // ── Agent streaming guard ─────────────────────────────────────
        // While the AI agent is streaming chunks into this file's buffer
        // (via `agentStreamAppendTab`) the React `value` prop changes on
        // every chunk. @monaco-editor/react does flag those as external
        // edits, but in practice a `controlled-component` race can still
        // make Monaco fire `onChange` with a STALE editor value just
        // after the next chunk lands in the store — which would clobber
        // the streamed content with the previous frame and ultimately
        // cause `agentStreamFinalizeTab` to persist OLD content to disk.
        //
        // We read the latest state via `getState()` so the callback's
        // dependency array stays narrow (no re-creation on every chunk).
        const streamingPaths = useStore.getState().agentStreamingPaths;
        if (tab && streamingPaths.has(tab.path)) {
          return;
        }

        updateTabContent(activeTabId, value);
        // Notify the LSP about the change (no-op for non-TS/JS files).
        if (tab && getLspLanguageId(tab.path)) {
          lspClient.changeDocument(tab.path, value);
        }
      }
    },
    [activeTabId, updateTabContent, activeTab]
  );

  // ── Manage didOpen / didClose for each tab ────────────────────────────
  // Whenever the set of open tabs changes we diff against what we last
  // sent: new tabs get didOpen, removed ones get didClose. Tabs whose
  // language LSP doesn't care about (e.g. markdown, json, images) are
  // skipped.
  useEffect(() => {
    const currentPaths = new Set(openTabs.map((t) => t.path));
    const previouslyOpened = openedTabPathsRef.current;

    // didOpen for newly opened tabs.
    for (const tab of openTabs) {
      if (previouslyOpened.has(tab.path)) continue;
      // Image tabs are never sent to the language server.
      if (tab.imageDataUrl) continue;
      if (!getLspLanguageId(tab.path)) continue;
      lspClient.openDocument(tab.path, tab.content);
      previouslyOpened.add(tab.path);
    }

    // didClose for tabs that have been closed.
    for (const oldPath of Array.from(previouslyOpened)) {
      if (!currentPaths.has(oldPath)) {
        lspClient.closeDocument(oldPath);
        previouslyOpened.delete(oldPath);
      }
    }
  }, [openTabs]);

  useEffect(() => {
    if (!activeTab || activeTab.imageDataUrl) {
      setHasTextSelection(false);
    }
  }, [activeTab, setHasTextSelection]);

  // Persist and restore Monaco view state (scroll, cursor, selection) when
  // switching tabs so the editor does not reset its viewport on every change.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const previousId = previousTabIdRef.current;
    const currentId = activeTab?.id ?? null;

    if (previousId && previousId !== currentId) {
      viewStatesRef.current.set(previousId, editor.saveViewState());
    }
    previousTabIdRef.current = currentId;

    if (currentId && !activeTab?.imageDataUrl) {
      // Wait for @monaco-editor/react to switch the model.
      requestAnimationFrame(() => {
        const saved = viewStatesRef.current.get(currentId);
        if (saved) {
          editor.restoreViewState(saved);
        }
        editor.focus();
      });
    }
  }, [activeTab?.id, activeTab?.imageDataUrl]);

  const containerRef = useRef<HTMLDivElement>(null);

  // Intercept Ctrl+F / Ctrl+H at the DOM level before Monaco sees them.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.shiftKey && key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('quebracho:open-find'));
        return;
      }
      if (mod && !e.shiftKey && key === 'h') {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('quebracho:open-replace'));
        return;
      }
    };
    el.addEventListener('keydown', handler, true);
    return () => el.removeEventListener('keydown', handler, true);
  }, []);

  if (!activeTab) {
    if (!workspacePath) return <WelcomeScreen />;
    return <EmptyWorkspacePlaceholder />;
  }

  // Image tabs are rendered as a non-editable preview instead of being
  // forced through Monaco (which would otherwise show garbled binary text
  // for PNG/JPG/etc.).
  if (activeTab.imageDataUrl) {
    return (
      <ImageViewer
        key={activeTab.id}
        fileName={activeTab.name}
        dataUrl={activeTab.imageDataUrl}
        fileSize={activeTab.fileSize}
      />
    );
  }

  // Database query tabs render a custom SQL editor + results grid.
  if (activeTab.dbConnectionId) {
    return <DbQueryEditor key={activeTab.id} tab={activeTab} />;
  }

  return (
    <div ref={containerRef} className="w-full h-full bg-quebracho-editor relative">
      <Editor
        // path becomes part of the Monaco model URI so completion / hover
        // providers can identify which file the request is for.
        path={activeTab.path}
        language={activeTab.language}
        value={activeTab.content}
        theme={getMonacoThemeName(colorTheme)}
        beforeMount={handleBeforeMount}
        onChange={handleChange}
        onMount={handleMount}
        options={editorOptions}
      />
      <FindReplaceOverlay editor={editorRef.current} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// EditorArea root
// ─────────────────────────────────────────────────────────────────────────
export default function EditorArea() {
  return (
    <div className="w-full h-full flex flex-col bg-quebracho-editor">
      <TabBar />
      <div className="flex-1 overflow-hidden">
        <MonacoWrapper />
      </div>
    </div>
  );
}
