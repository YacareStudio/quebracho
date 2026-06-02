import { useCallback, useEffect, useRef } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import { useStore } from '../store';
import { X } from 'lucide-react';
import type { editor } from 'monaco-editor';
import logoUrl from '../assets/quebracho-logo.png';
import { lspClient, getLspLanguageId } from '../lsp/client';
import ImageViewer from './ImageViewer';
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

// ─────────────────────────────────────────────────────────────────────────
// Welcome Screen
// ─────────────────────────────────────────────────────────────────────────
function WelcomeScreen() {
  const openFolder = useStore((s) => s.openFolder);
  const uiLanguage = useStore((s) => s.uiLanguage);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-forge-editor gap-6 select-none">
      <img src={logoUrl} alt="Quebracho" className="w-[88px] h-[88px] object-contain opacity-60" />
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-3xl font-light text-forge-text-strong/70 tracking-wide">Quebracho</h1>
        <p className="text-[12px] text-forge-text/45">{t(uiLanguage, 'welcome.byline')}</p>
      </div>
      <div className="flex flex-col items-center gap-3 text-sm">
        <p className="text-forge-text/50">{t(uiLanguage, 'welcome.start')}</p>
        <button
          onClick={() => openFolder()}
          className="text-forge-accent hover:underline cursor-pointer"
        >
          {t(uiLanguage, 'welcome.openFolder')}
        </button>
        <div className="flex flex-col items-center gap-1 mt-4 text-forge-text/40 text-xs">
          <p>
            <kbd className="px-1.5 py-0.5 bg-forge-input rounded text-forge-text/70">Ctrl+Shift+P</kbd>{' '}
            {t(uiLanguage, 'welcome.commandPalette')}
          </p>
          <p>
            <kbd className="px-1.5 py-0.5 bg-forge-input rounded text-forge-text/70">Ctrl+B</kbd>{' '}
            {t(uiLanguage, 'welcome.toggleSidebar')}
          </p>
          <p>
            <kbd className="px-1.5 py-0.5 bg-forge-input rounded text-forge-text/70">Ctrl+`</kbd>{' '}
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
    <div className="w-full h-full flex items-center justify-center bg-forge-editor select-none">
      <div className="px-6 py-5 rounded-md border border-forge-border/70 bg-forge-sidebar/35 text-center max-w-[460px]">
        <p className="text-[14px] text-forge-text-strong/85 mb-2">{t(uiLanguage, 'welcome.workspaceReadyTitle')}</p>
        <p className="text-[12px] text-forge-text/60">{t(uiLanguage, 'welcome.workspaceReadyBody')}</p>
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
  const closeTab = useStore((s) => s.closeTab);

  if (openTabs.length === 0) return null;

  return (
    <div className="h-[35px] bg-forge-tabbar flex items-end overflow-x-auto select-none">
      {openTabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`group flex items-center h-[35px] px-3 gap-2 cursor-pointer min-w-0 max-w-[220px] border-r border-black/30 transition-colors
              ${isActive
                ? 'bg-forge-tab-active'
                : 'bg-forge-tabbar hover:bg-white/[0.03]'}
            `}
          >
            {tab.isUnsaved && (
              <div className="w-[7px] h-[7px] rounded-full bg-forge-text/70 flex-shrink-0" />
            )}

            <span
              className="truncate text-[13px]"
              style={{ color: isActive ? '#4ADB94' : '#96969D' }}
            >
              {tab.name}
            </span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className={`tab-close p-0.5 flex-shrink-0
                ${isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 hover:!opacity-100'}
              `}
              style={{ color: isActive ? '#96969D' : '#96969D' }}
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
// Custom Monaco Theme — "forge-dark"
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
      console.debug('[forge] Monaco TS diagnostics setup skipped:', (err as Error)?.message);
    }

    // Wire the LSP client into Monaco. attachMonaco is idempotent — it
    // registers the providers and the diagnostics listener exactly once.
    try {
      lspClient.attachMonaco(monaco);
    } catch (err) {
      console.warn('[forge] LSP attach failed:', (err as Error)?.message);
    }
  }, []);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    editor.focus();

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

    window.addEventListener('forge:editor-command', onEditorCommand);
    return () => window.removeEventListener('forge:editor-command', onEditorCommand);
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

  return (
    <div className="w-full h-full bg-forge-editor">
      <Editor
        key={activeTab.id}
        // path becomes part of the Monaco model URI so completion / hover
        // providers can identify which file the request is for.
        path={activeTab.path}
        language={activeTab.language}
        value={activeTab.content}
        theme={getMonacoThemeName(colorTheme)}
        beforeMount={handleBeforeMount}
        onChange={handleChange}
        onMount={handleMount}
        options={{
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
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// EditorArea root
// ─────────────────────────────────────────────────────────────────────────
export default function EditorArea() {
  return (
    <div className="w-full h-full flex flex-col bg-forge-editor">
      <TabBar />
      <div className="flex-1 overflow-hidden">
        <MonacoWrapper />
      </div>
    </div>
  );
}
