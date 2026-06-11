import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStore } from '../store';
import { isHtmlFile, type TreeNode } from '../types';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Plus,
  Search,
  GitBranch,
  ListTree,
  History,
  Globe,
} from 'lucide-react';
import { t } from '../i18n';
import { confirmAction } from '../confirm';
import { ExplorerNodeIcon } from '../theme/fileIcons';
import DatabasePanel from './DatabasePanel';
import SearchPanel from './SearchPanel';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns the set of folder paths that lie on the directory chain of the
 * currently active editor file. Used to highlight ancestors of the open file.
 */
function getActiveFolderPaths(activeFilePath: string | null): Set<string> {
  const result = new Set<string>();
  if (!activeFilePath) return result;

  const sep =
    activeFilePath.includes('\\') && !activeFilePath.includes('/')
      ? '\\'
      : '/';

  let cur = activeFilePath;
  while (cur.includes(sep)) {
    cur = cur.substring(0, cur.lastIndexOf(sep));
    if (cur) result.add(cur);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Context Menu
// ─────────────────────────────────────────────────────────────────────────
interface CtxMenuState {
  x: number;
  y: number;
  node: TreeNode;
}

function ContextMenu({
  state,
  onClose,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onLiveServerToggle,
  liveServerActive,
  liveServerHtmlPath,
}: {
  state: CtxMenuState;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  /** Optional handler that toggles the live server on this HTML file. */
  onLiveServerToggle: () => void;
  /** Current live-server state — used to decide between "Iniciar" / "Detener". */
  liveServerActive: boolean;
  /** Absolute path of the HTML file that the live server is currently
   *  rooted on (for "Detener" — null when no server is running). */
  liveServerHtmlPath: string | null;
}) {
  const uiLanguage = useStore((s) => s.uiLanguage);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  // Show the Live Server entry on HTML files. Wording:
  //   - "Iniciar Live Server" when no server is running, OR a server is
  //     running on a different file (we'll restart it on this file).
  //   - "Detener Live Server" when the server is rooted on THIS file's
  //     directory and serving THIS file.
  const isHtml = state.node.type === 'file' && isHtmlFile(state.node.path);
  const isServingThisFile =
    liveServerActive &&
    liveServerHtmlPath !== null &&
    liveServerHtmlPath === state.node.path;
  const liveServerLabel = isServingThisFile
    ? t(uiLanguage, 'explorer.stopLiveServer')
    : t(uiLanguage, 'explorer.startLiveServer');

  return (
    <div
      ref={ref}
      className="context-menu fixed"
      style={{ top: state.y, left: state.x }}
      onClick={(e) => e.stopPropagation()}
    >
      {isHtml && (
        <>
          <div
            className="context-menu-item flex items-center gap-2"
            onClick={() => {
              onLiveServerToggle();
              onClose();
            }}
          >
            <Globe
              size={13}
              className={isServingThisFile ? 'text-quebracho-accent' : 'text-quebracho-text/70'}
            />
            <span>{liveServerLabel}</span>
          </div>
          <div className="context-menu-divider" />
        </>
      )}
      <div className="context-menu-item" onClick={() => { onNewFile(); onClose(); }}>{t(uiLanguage, 'explorer.newFile')}</div>
      <div className="context-menu-item" onClick={() => { onNewFolder(); onClose(); }}>{t(uiLanguage, 'explorer.newFolder')}</div>
      <div className="context-menu-divider" />
      <div className="context-menu-item" onClick={() => { onRename(); onClose(); }}>{t(uiLanguage, 'explorer.rename')}</div>
      <div className="context-menu-item" onClick={() => { onDelete(); onClose(); }}>{t(uiLanguage, 'explorer.delete')}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// File Tree Item
// ─────────────────────────────────────────────────────────────────────────
interface InlineCreate {
  parentPath: string;
  type: 'file' | 'folder';
}

function TreeItem({
  node,
  depth,
  activeFolderPaths,
  onContextMenu,
  inlineCreate,
  setInlineCreate,
  renameNodeId,
  setRenameNodeId,
}: {
  node: TreeNode;
  depth: number;
  activeFolderPaths: Set<string>;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  inlineCreate: InlineCreate | null;
  setInlineCreate: (i: InlineCreate | null) => void;
  renameNodeId: string | null;
  setRenameNodeId: (id: string | null) => void;
}) {
  const expandedFolders = useStore((s) => s.expandedFolders);
  const toggleFolder = useStore((s) => s.toggleFolder);
  const openFile = useStore((s) => s.openFile);
  const activeTabId = useStore((s) => s.activeTabId);
  const selectedPath = useStore((s) => s.selectedPath);
  const setSelectedPath = useStore((s) => s.setSelectedPath);
  const fileIconTheme = useStore((s) => s.fileIconTheme);
  const createNewFile = useStore((s) => s.createNewFile);
  const createNewDirectory = useStore((s) => s.createNewDirectory);
  const renameItem = useStore((s) => s.renameItem);

  const isExpanded = expandedFolders.has(node.id);
  const isDirectory = node.type === 'directory';
  const isActiveFile = activeTabId === node.path;
  const isActiveFolder = isDirectory && activeFolderPaths.has(node.path);
  const isSelected = selectedPath === node.path;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Always update sidebar selection.
    setSelectedPath({ path: node.path, kind: isDirectory ? 'directory' : 'file' });
    if (isDirectory) {
      toggleFolder(node.id);
    } else {
      openFile(node);
    }
  };

  const isRenaming = renameNodeId === node.id;
  const showInlineCreate = inlineCreate && inlineCreate.parentPath === node.path && isDirectory && isExpanded;

  const itemTextClass =
    isDirectory && isActiveFolder
      ? 'text-quebracho-accent'
      : !isDirectory && isActiveFile
        ? 'text-quebracho-text-strong'
        : 'text-quebracho-text';

  return (
    <>
      {!isRenaming && (
        <div
          onClick={handleClick}
          onContextMenu={(e) => {
            // Right-click also selects
            setSelectedPath({ path: node.path, kind: isDirectory ? 'directory' : 'file' });
            onContextMenu(e, node);
          }}
          className={`tree-item flex items-center cursor-pointer h-6 pr-2 transition-colors ${itemTextClass} ${isSelected ? 'bg-quebracho-accent/10' : ''}`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          {isDirectory ? (
            <span className="mr-0.5 shrink-0">
              {isExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </span>
          ) : (
            <span className="w-3.5 mr-0.5 shrink-0" />
          )}

          <span className="mr-1.5 shrink-0 inline-flex items-center">
            <ExplorerNodeIcon
              theme={fileIconTheme}
              type={isDirectory ? 'directory' : 'file'}
              fileName={node.name}
              expanded={isExpanded}
              active={isDirectory ? isActiveFolder : isActiveFile}
            />
          </span>

          <span className="truncate text-[13px]">
            {node.name}
          </span>
        </div>
      )}

      {isRenaming && (
        <RenameInput
          initial={node.name}
          depth={depth}
          onSubmit={async (name) => {
            const trimmed = name.trim();
            if (trimmed && trimmed !== node.name) {
              await renameItem(node.path, trimmed);
            }
            setRenameNodeId(null);
          }}
          onCancel={() => setRenameNodeId(null)}
        />
      )}

      {isDirectory && isExpanded && node.children && (
        <div>
          {showInlineCreate && (
            <NewItemInput
              type={inlineCreate!.type}
              depth={depth + 1}
              onSubmit={async (name) => {
                const trimmed = name.trim();
                if (trimmed) {
                  if (inlineCreate!.type === 'file') {
                    await createNewFile(node.path, trimmed);
                  } else {
                    await createNewDirectory(node.path, trimmed);
                  }
                }
                setInlineCreate(null);
              }}
              onCancel={() => setInlineCreate(null)}
            />
          )}
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeFolderPaths={activeFolderPaths}
              onContextMenu={onContextMenu}
              inlineCreate={inlineCreate}
              setInlineCreate={setInlineCreate}
              renameNodeId={renameNodeId}
              setRenameNodeId={setRenameNodeId}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Inline input for creating a new file/folder under a folder.
//
// Focus handling notes:
//  • We focus on mount via a `setTimeout(0)` so that any in-flight re-renders
//    (e.g. from the dropdown closing or `expandFolder` updating the
//    `expandedFolders` Set) settle before we ask the input to take focus.
//  • Click / mousedown propagation is stopped on both the wrapper and the
//    input so the explorer's `onClick={handleEmptyClick}` (which clears the
//    sidebar selection and triggers a re-render) doesn't fight us.
//  • A `submittedRef` guards against double-submission caused by Enter
//    triggering `onBlur` immediately after `onSubmit`.
//  • Key events are also stopped from bubbling so the global Ctrl+S / Esc
//    handlers in App.tsx don't intercept what the user is typing.
function NewItemInput({
  type,
  depth,
  onSubmit,
  onCancel,
}: {
  type: 'file' | 'folder';
  depth: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const uiLanguage = useStore((s) => s.uiLanguage);
  const [val, setVal] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  const composingRef = useRef(false);

  useEffect(() => {
    // Defer focus to the next tick so any concurrent re-renders settle first.
    const id = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      // Keep the cursor at the end if the field already has a value.
      const len = el.value.length;
      try { el.setSelectionRange(len, len); } catch { /* noop */ }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const submit = (name: string) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onSubmit(name);
  };

  const cancel = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onCancel();
  };

  return (
    <div
      className="flex items-center h-6.5 pr-2"
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="w-3.5 mr-0.5 shrink-0" />
      <span className="mr-1.5 shrink-0 inline-flex items-center">
        {type === 'folder' ? (
          <Folder size={15} className="text-quebracho-accent" />
        ) : (
          <File size={14} className="text-quebracho-accent" />
        )}
      </span>
      <input
        ref={ref}
        className="flex-1 bg-quebracho-input text-quebracho-text text-[13px] px-1.5 py-0.5 border border-quebracho-accent outline-none rounded-sm"
        placeholder={type === 'file' ? t(uiLanguage, 'explorer.fileNamePlaceholder') : t(uiLanguage, 'explorer.folderNamePlaceholder')}
        value={val}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setVal(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        onKeyDown={(e) => {
          // Don't let global shortcuts hijack typing.
          e.stopPropagation();
          if (composingRef.current) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            submit(val);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => submit(val)}
      />
    </div>
  );
}

function RenameInput({
  initial,
  depth,
  onSubmit,
  onCancel,
}: {
  initial: string;
  depth: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  const composingRef = useRef(false);

  useEffect(() => {
    const id = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      try { el.select(); } catch { /* noop */ }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const submit = (name: string) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onSubmit(name);
  };

  const cancel = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onCancel();
  };

  return (
    <div
      className="flex items-center h-6.5 pr-2"
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="w-3.5 mr-0.5 shrink-0" />
      <span className="mr-1.5 shrink-0 inline-flex items-center">
        <File size={14} className="text-quebracho-accent" />
      </span>
      <input
        ref={ref}
        className="flex-1 bg-quebracho-input text-quebracho-text text-[13px] px-1.5 py-0.5 border border-quebracho-accent outline-none rounded-sm"
        value={val}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setVal(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (composingRef.current) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            submit(val);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => submit(val)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Add (+) Dropdown
// ─────────────────────────────────────────────────────────────────────────
function AddDropdown({
  onPick,
  onClose,
}: {
  onPick: (type: 'file' | 'folder') => void;
  onClose: () => void;
}) {
  const uiLanguage = useStore((s) => s.uiLanguage);
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<'file' | 'folder' | null>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="dropdown-menu absolute right-2 top-9 z-30 pt-1 pb-1 min-w-35"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className={`block w-full text-left pl-3 pr-3 pt-1 pb-1.5 text-[13px] transition-colors ${hover === 'file' ? 'text-quebracho-accent' : 'text-quebracho-text-menu'}`}
        onMouseEnter={() => setHover('file')}
        onMouseLeave={() => setHover(null)}
        onClick={() => onPick('file')}
      >
        {t(uiLanguage, 'explorer.newFile')}
      </button>
      <button
        className={`block w-full text-left pl-3 pr-3 pt-1 pb-1.5 text-[13px] transition-colors ${hover === 'folder' ? 'text-quebracho-accent' : 'text-quebracho-text-menu'}`}
        onMouseEnter={() => setHover('folder')}
        onMouseLeave={() => setHover(null)}
        onClick={() => onPick('folder')}
      >
        {t(uiLanguage, 'explorer.newFolder')}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Header Context Menu ("Close Folder")
// ─────────────────────────────────────────────────────────────────────────
interface HeaderCtxMenuState {
  x: number;
  y: number;
}

function HeaderContextMenu({
  state,
  onClose,
  onCloseFolder,
}: {
  state: HeaderCtxMenuState;
  onClose: () => void;
  onCloseFolder: () => void;
}) {
  const uiLanguage = useStore((s) => s.uiLanguage);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu fixed"
      style={{ top: state.y, left: state.x }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="context-menu-item"
        onClick={() => {
          onCloseFolder();
          onClose();
        }}
      >
        {t(uiLanguage, 'explorer.closeFolder')}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Explorer Panel (file tree)
// ─────────────────────────────────────────────────────────────────────────
function ExplorerPanel() {
  const uiLanguage = useStore((s) => s.uiLanguage);
  const fileTree = useStore((s) => s.fileTree);
  const workspacePath = useStore((s) => s.workspacePath);
  const openFolder = useStore((s) => s.openFolder);
  const closeWorkspace = useStore((s) => s.closeWorkspace);
  const activeTabId = useStore((s) => s.activeTabId);
  const createNewFile = useStore((s) => s.createNewFile);
  const createNewDirectory = useStore((s) => s.createNewDirectory);
  const deleteItem = useStore((s) => s.deleteItem);
  const expandFolder = useStore((s) => s.expandFolder);
  const setSelectedPath = useStore((s) => s.setSelectedPath);
  const resolveCreateParent = useStore((s) => s.resolveCreateParent);
  // Live server state — used by the per-file context menu.
  const liveServerActive = useStore((s) => s.liveServerActive);
  const liveServerRoot = useStore((s) => s.liveServerRoot);
  const liveServerHtmlFile = useStore((s) => s.liveServerHtmlFile);
  const startLiveServer = useStore((s) => s.startLiveServer);
  const stopLiveServer = useStore((s) => s.stopLiveServer);

  // Compute the full absolute path of the HTML file currently being served,
  // joining root + basename with the OS-appropriate separator. We don't have
  // `path.join` in the renderer, so reuse whichever separator is already in
  // use in the root path string.
  const liveServerHtmlPath = useMemo<string | null>(() => {
    if (!liveServerActive || !liveServerRoot || !liveServerHtmlFile) return null;
    const sep =
      liveServerRoot.includes('\\') && !liveServerRoot.includes('/') ? '\\' : '/';
    return liveServerRoot.endsWith(sep)
      ? `${liveServerRoot}${liveServerHtmlFile}`
      : `${liveServerRoot}${sep}${liveServerHtmlFile}`;
  }, [liveServerActive, liveServerRoot, liveServerHtmlFile]);

  // Always derive the display name from the workspace path so it is just the
  // last path segment (folder name), even on Windows back-slash paths.
  const folderDisplayName = useMemo(() => {
    if (!workspacePath) return '';
    const segments = workspacePath.split(/[\\/]/).filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : workspacePath;
  }, [workspacePath]);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [inlineCreate, setInlineCreate] = useState<InlineCreate | null>(null);
  const [renameNodeId, setRenameNodeId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [headerCtxMenu, setHeaderCtxMenu] = useState<HeaderCtxMenuState | null>(null);

  // Folder-highlight chain — derived from the active tab's file path.
  // Re-computed on every activeTabId change so tab switches update the tree.
  const activeFolderPaths = useMemo(
    () => getActiveFolderPaths(activeTabId),
    [activeTabId]
  );

  // Smart "+" — uses the current sidebar selection to choose the parent.
  const handleAddPick = useCallback(
    (type: 'file' | 'folder') => {
      setDropdownOpen(false);
      const parent = resolveCreateParent();
      if (!parent) return;
      // If the parent is a folder we can drill into, expand it so the inline
      // input shows up where the new item will live.
      if (parent !== workspacePath) {
        // Find the matching node id (id === path in our tree)
        expandFolder(parent);
      }
      setInlineCreate({ parentPath: parent, type });
    },
    [resolveCreateParent, workspacePath, expandFolder]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const handleCtxNewFile = useCallback(() => {
    if (!ctxMenu) return;
    const parentPath = ctxMenu.node.type === 'directory'
      ? ctxMenu.node.path
      : (ctxMenu.node.path.includes('/')
          ? ctxMenu.node.path.substring(0, ctxMenu.node.path.lastIndexOf('/'))
          : ctxMenu.node.path.substring(0, ctxMenu.node.path.lastIndexOf('\\')));
    if (ctxMenu.node.type === 'directory') expandFolder(ctxMenu.node.id);
    setInlineCreate({ parentPath, type: 'file' });
  }, [ctxMenu, expandFolder]);

  const handleCtxNewFolder = useCallback(() => {
    if (!ctxMenu) return;
    const parentPath = ctxMenu.node.type === 'directory'
      ? ctxMenu.node.path
      : (ctxMenu.node.path.includes('/')
          ? ctxMenu.node.path.substring(0, ctxMenu.node.path.lastIndexOf('/'))
          : ctxMenu.node.path.substring(0, ctxMenu.node.path.lastIndexOf('\\')));
    if (ctxMenu.node.type === 'directory') expandFolder(ctxMenu.node.id);
    setInlineCreate({ parentPath, type: 'folder' });
  }, [ctxMenu, expandFolder]);

  const handleCtxRename = useCallback(() => {
    if (!ctxMenu) return;
    setRenameNodeId(ctxMenu.node.id);
  }, [ctxMenu]);

  const handleCtxDelete = useCallback(async () => {
    if (!ctxMenu) return;
    if (await confirmAction(t(uiLanguage, 'explorer.confirmDelete', { name: ctxMenu.node.name }))) {
      await deleteItem(ctxMenu.node.path);
    }
  }, [ctxMenu, deleteItem, uiLanguage]);

  // Toggle the live server for the right-clicked HTML file. When the server
  // is already serving THIS file, stop it; otherwise start (or restart) on
  // the new file.
  const handleCtxLiveServerToggle = useCallback(async () => {
    if (!ctxMenu) return;
    if (ctxMenu.node.type !== 'file') return;
    if (!isHtmlFile(ctxMenu.node.path)) return;

    if (liveServerActive && liveServerHtmlPath === ctxMenu.node.path) {
      await stopLiveServer();
    } else {
      await startLiveServer(ctxMenu.node.path);
    }
  }, [ctxMenu, liveServerActive, liveServerHtmlPath, startLiveServer, stopLiveServer]);

  // Click on empty area inside the explorer clears the sidebar selection so
  // that the next "+" creates at the workspace root.
  const handleEmptyClick = useCallback(() => {
    setSelectedPath(null);
  }, [setSelectedPath]);

  if (!workspacePath) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 pl-4 pr-4 text-quebracho-text">
        <p className="text-sm text-center">{t(uiLanguage, 'explorer.noFolderOpened')}</p>
        <button
          onClick={() => openFolder()}
          className="pl-4 pr-4 pt-1 pb-1.5 bg-quebracho-accent text-quebracho-bg text-sm font-semibold rounded hover:opacity-90 transition-opacity"
        >
          {t(uiLanguage, 'explorer.openFolder')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Top bar: folder name + add button */}
      <div className="flex items-center justify-between h-9 pl-3 pr-3 border-b border-quebracho-border/40">
        <button
          title={workspacePath ?? undefined}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setHeaderCtxMenu({ x: e.clientX, y: e.clientY });
          }}
          className="flex items-center gap-1 text-quebracho-accent text-[13px] font-semibold uppercase tracking-wide truncate"
        >
          <span className="truncate">{folderDisplayName}</span>
          <ChevronDown size={14} className="shrink-0" />
        </button>

        <button
          onClick={() => setDropdownOpen((v) => !v)}
          title={t(uiLanguage, 'explorer.newEllipsis')}
          className="p-1 rounded hover:bg-quebracho-hover transition-colors"
        >
          <Plus size={16} className="text-quebracho-accent" />
        </button>

        {dropdownOpen && (
          <AddDropdown onPick={handleAddPick} onClose={() => setDropdownOpen(false)} />
        )}
      </div>

      {/* Inline create at root */}
      {inlineCreate && inlineCreate.parentPath === workspacePath && (
        <NewItemInput
          type={inlineCreate.type}
          depth={0}
          onSubmit={async (name) => {
            const trimmed = name.trim();
            if (trimmed) {
              if (inlineCreate.type === 'file') {
                await createNewFile(workspacePath, trimmed);
              } else {
                await createNewDirectory(workspacePath, trimmed);
              }
            }
            setInlineCreate(null);
          }}
          onCancel={() => setInlineCreate(null)}
        />
      )}

      {/* File Tree */}
      <div
        className="flex-1 overflow-y-auto sidebar-scroll pt-1 pb-1"
        onClick={handleEmptyClick}
      >
        {fileTree.map((node) => (
          <TreeItem
            key={node.id}
            node={node}
            depth={0}
            activeFolderPaths={activeFolderPaths}
            onContextMenu={handleContextMenu}
            inlineCreate={inlineCreate}
            setInlineCreate={setInlineCreate}
            renameNodeId={renameNodeId}
            setRenameNodeId={setRenameNodeId}
          />
        ))}
      </div>

      {ctxMenu && (
        <ContextMenu
          state={ctxMenu}
          onClose={() => setCtxMenu(null)}
          onRename={handleCtxRename}
          onDelete={handleCtxDelete}
          onNewFile={handleCtxNewFile}
          onNewFolder={handleCtxNewFolder}
          onLiveServerToggle={handleCtxLiveServerToggle}
          liveServerActive={liveServerActive}
          liveServerHtmlPath={liveServerHtmlPath}
        />
      )}

      {headerCtxMenu && (
        <HeaderContextMenu
          state={headerCtxMenu}
          onClose={() => setHeaderCtxMenu(null)}
          onCloseFolder={closeWorkspace}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Bottom Section: Outline + Timeline (collapsible)
// ─────────────────────────────────────────────────────────────────────────
function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-quebracho-border/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 pl-3 pr-3 h-7 text-[11px] font-semibold uppercase tracking-wider text-quebracho-text hover:text-quebracho-text-strong transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="ml-1 inline-flex items-center gap-1.5">
          {icon}
          {title}
        </span>
      </button>
      {open && (
        <div className="pl-3 pr-3 pt-2 pb-2 text-[12px] text-quebracho-text/60 max-h-35 overflow-y-auto sidebar-scroll">
          {children}
        </div>
      )}
    </div>
  );
}

function BottomSections() {
  const uiLanguage = useStore((s) => s.uiLanguage);
  return (
    <div className="shrink-0">
      <CollapsibleSection title={t(uiLanguage, 'explorer.outline')} icon={<ListTree size={12} />}>
        <p className="italic">{t(uiLanguage, 'explorer.noSymbols')}</p>
      </CollapsibleSection>
      <CollapsibleSection title={t(uiLanguage, 'explorer.timeline')} icon={<History size={12} />}>
        <p className="italic">{t(uiLanguage, 'explorer.noTimeline')}</p>
      </CollapsibleSection>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Placeholder panels (for non-explorer activity items)
// ─────────────────────────────────────────────────────────────────────────
function PlaceholderPanel({ icon, title }: { icon: React.ReactNode; title: string }) {
  const uiLanguage = useStore((s) => s.uiLanguage);
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-quebracho-text">
      {icon}
      <p className="text-sm">{title}</p>
      <p className="text-xs text-quebracho-text/60">{t(uiLanguage, 'explorer.comingSoon')}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SideBar root
// ─────────────────────────────────────────────────────────────────────────
export default function SideBar() {
  const activeSidebarPanel = useStore((s) => s.activeSidebarPanel);
  const uiLanguage = useStore((s) => s.uiLanguage);

  const renderTopArea = () => {
    return (
      <>
        <div style={{ display: activeSidebarPanel === 'explorer' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <ExplorerPanel />
        </div>
        <div style={{ display: activeSidebarPanel === 'search' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <SearchPanel />
        </div>
        <div style={{ display: activeSidebarPanel === 'git' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <PlaceholderPanel icon={<GitBranch size={36} />} title={t(uiLanguage, 'activity.sourceControl')} />
        </div>
        <div style={{ display: activeSidebarPanel === 'database' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <DatabasePanel />
        </div>
      </>
    );
  };

  return (
    <div className="w-full h-full bg-quebracho-sidebar flex flex-col border-r border-quebracho-border/40 overflow-hidden">
      <div className="flex-1 overflow-hidden flex flex-col">
        {renderTopArea()}
      </div>
      <BottomSections />
    </div>
  );
}
