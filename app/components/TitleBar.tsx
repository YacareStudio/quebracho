import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { Check, ChevronRight, Copy, Minus, Square, X } from 'lucide-react';
import logoUrl from '../assets/quebracho-logo.png';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { t } from '../i18n';

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

type MenuItem = {
  id: string;
  label?: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  onClick?: () => void | Promise<void>;
  submenu?: MenuItem[];
  divider?: boolean;
};

type MenuId = 'file' | 'edit' | 'view' | 'help';

type MenuItemWithMnemonic = MenuItem & {
  mnemonicIndex?: number;
  mnemonicChar?: string;
  submenu?: MenuItemWithMnemonic[];
};

function normalizeMnemonicChar(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isWordChar(ch: string): boolean {
  return /[a-zA-Z0-9]/.test(ch);
}

function pickMnemonicIndex(label: string, used: Set<string>): number {
  const candidates: number[] = [];

  for (let i = 0; i < label.length; i += 1) {
    const ch = label[i];
    if (!isWordChar(ch)) continue;
    const prev = i > 0 ? label[i - 1] : ' ';
    if (!isWordChar(prev)) {
      candidates.push(i);
    }
  }

  for (let i = 0; i < label.length; i += 1) {
    const ch = label[i];
    if (!isWordChar(ch)) continue;
    if (!candidates.includes(i)) candidates.push(i);
  }

  for (const idx of candidates) {
    const key = normalizeMnemonicChar(label[idx]);
    if (!key || used.has(key)) continue;
    used.add(key);
    return idx;
  }

  return -1;
}

function withMnemonics(items: MenuItem[]): MenuItemWithMnemonic[] {
  const used = new Set<string>();
  return items.map((item) => {
    if (item.divider || !item.label) {
      return {
        ...item,
        submenu: item.submenu ? withMnemonics(item.submenu) : item.submenu,
      };
    }

    const mnemonicIndex = pickMnemonicIndex(item.label, used);
    const mnemonicChar =
      mnemonicIndex >= 0 ? normalizeMnemonicChar(item.label[mnemonicIndex]) : undefined;

    return {
      ...item,
      mnemonicIndex,
      mnemonicChar,
      submenu: item.submenu ? withMnemonics(item.submenu) : item.submenu,
    };
  });
}

function renderMnemonicLabel(label: string, index: number | undefined, visible: boolean) {
  if (!visible || index === undefined || index < 0 || index >= label.length) {
    return <span>{label}</span>;
  }

  return (
    <span>
      {label.slice(0, index)}
      <span style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}>{label[index]}</span>
      {label.slice(index + 1)}
    </span>
  );
}

export default function TitleBar() {
  const workspaceName = useStore((s) => s.workspaceName);
  const workspacePath = useStore((s) => s.workspacePath);
  const openFolder = useStore((s) => s.openFolder);
  const openFilePath = useStore((s) => s.openFilePath);
  const closeWorkspace = useStore((s) => s.promptCloseWorkspace);
  const closeTab = useStore((s) => s.promptCloseTab);
  const activeTabId = useStore((s) => s.activeTabId);
  const openTabs = useStore((s) => s.openTabs);
  const saveFile = useStore((s) => s.saveFile);
  const saveAllFiles = useStore((s) => s.saveAllFiles);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const togglePanel = useStore((s) => s.togglePanel);
  const toggleAIPanel = useStore((s) => s.toggleAIPanel);
  const toggleActivityBar = useStore((s) => s.toggleActivityBar);
  const toggleStatusBar = useStore((s) => s.toggleStatusBar);
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const bottomPanelVisible = useStore((s) => s.bottomPanelVisible);
  const aiPanelVisible = useStore((s) => s.aiPanelVisible);
  const activityBarVisible = useStore((s) => s.activityBarVisible);
  const statusBarVisible = useStore((s) => s.statusBarVisible);
  const setSidebarPanel = useStore((s) => s.setSidebarPanel);
  const setBottomTab = useStore((s) => s.setBottomTab);
  const hasTextSelection = useStore((s) => s.hasTextSelection);
  const uiLanguage = useStore((s) => s.uiLanguage);
  const [isMaximized, setIsMaximized] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [activeMenuItemId, setActiveMenuItemId] = useState<string | null>(null);
  const [mnemonicMode, setMnemonicMode] = useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const menuRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const isTauriRuntime =
      typeof window !== 'undefined' &&
      typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
    if (!isTauriRuntime) return;

    const w = getCurrentWindow();
    let unlisten: (() => void) | null = null;

    const syncMaximized = () => {
      void w.isMaximized().then(setIsMaximized).catch(() => {
        // no-op
      });
    };

    syncMaximized();
    void w.onResized(() => {
      syncMaximized();
    }).then((dispose) => {
      unlisten = dispose;
    }).catch(() => {
      // no-op
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleMinimize = () => window.forgeAPI?.minimize();
  const handleMaximize = () => window.forgeAPI?.maximize();
  const handleClose = () => window.forgeAPI?.requestClose();

  const emitEditorCommand = (command: EditorMenuCommand) => {
    window.dispatchEvent(new CustomEvent('quebracho:editor-command', { detail: { command } }));
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRootRef.current) return;
      if (menuRootRef.current.contains(event.target as Node)) return;
      setOpenMenu(null);
      setOpenSubmenuId(null);
      setActiveMenuItemId(null);
      setMnemonicMode(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenMenu(null);
      setOpenSubmenuId(null);
      setActiveMenuItemId(null);
      setMnemonicMode(false);
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const runCheckUpdates = async () => {
    setOpenMenu(null);
    setOpenSubmenuId(null);

    if (!window.forgeAPI?.updates?.checkAndInstall) {
      alert(t(uiLanguage, 'titleBar.updateUnavailable'));
      return;
    }

    setIsCheckingUpdates(true);
    try {
      const result = await window.forgeAPI.updates.checkAndInstall();
      alert(result.message);
    } catch (err) {
      alert(
        t(uiLanguage, 'titleBar.updateFailed', {
          error: (err as Error)?.message || String(err),
        }),
      );
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const runAbout = async () => {
    setOpenMenu(null);
    setOpenSubmenuId(null);

    try {
      const info = await window.forgeAPI.appInfo();
      alert(
        t(uiLanguage, 'titleBar.aboutBody', {
          name: info.name,
          version: info.version,
        }),
      );
    } catch {
      alert(
        t(uiLanguage, 'titleBar.aboutBody', {
          name: 'Quebracho',
          version: '1.0.0',
        }),
      );
    }
  };

  const fileMenuItems = useMemo<MenuItem[]>(() => [
    {
      id: 'open-file',
      label: t(uiLanguage, 'titleBar.fileOpenFile'),
      shortcut: 'Ctrl+O',
      onClick: () => void openFilePath(),
    },
    {
      id: 'open-folder',
      label: t(uiLanguage, 'titleBar.fileOpenFolder'),
      shortcut: 'Ctrl+K Ctrl+O',
      onClick: () => void openFolder(),
    },
    {
      id: 'close-file',
      label: t(uiLanguage, 'titleBar.fileCloseFile'),
      shortcut: 'Ctrl+W',
      disabled: !activeTabId,
      onClick: () => {
        if (!activeTabId) return;
        void closeTab(activeTabId);
      },
    },
    {
      id: 'close-project',
      label: t(uiLanguage, 'titleBar.fileCloseProject'),
      disabled: !workspacePath,
      onClick: () => closeWorkspace(),
    },
    { id: 'file-divider-1', divider: true },
    {
      id: 'save',
      label: t(uiLanguage, 'titleBar.fileSave'),
      shortcut: 'Ctrl+S',
      disabled: !activeTabId || !openTabs.some((tab) => tab.id === activeTabId && tab.isUnsaved),
      onClick: () => void saveFile(),
    },
    {
      id: 'save-all',
      label: t(uiLanguage, 'titleBar.fileSaveAll'),
      shortcut: 'Ctrl+Shift+S',
      disabled: !openTabs.some((tab) => tab.isUnsaved),
      onClick: () => void saveAllFiles(),
    },
    { id: 'file-divider-2', divider: true },
    {
      id: 'exit',
      label: t(uiLanguage, 'titleBar.fileExit'),
      onClick: () => window.forgeAPI?.requestClose(),
    },
  ], [activeTabId, closeTab, closeWorkspace, openFilePath, openFolder, openTabs, saveAllFiles, saveFile, uiLanguage, workspacePath]);

  const editTextTransformSubmenu = useMemo<MenuItem[]>(() => [
    { id: 'to-upper', label: t(uiLanguage, 'titleBar.editUppercase'), onClick: () => emitEditorCommand('to-upper') },
    { id: 'to-lower', label: t(uiLanguage, 'titleBar.editLowercase'), onClick: () => emitEditorCommand('to-lower') },
    { id: 'to-snake', label: t(uiLanguage, 'titleBar.editSnakeCase'), onClick: () => emitEditorCommand('to-snake') },
    { id: 'to-camel', label: t(uiLanguage, 'titleBar.editCamelCase'), onClick: () => emitEditorCommand('to-camel') },
    { id: 'to-kebab', label: t(uiLanguage, 'titleBar.editKebabCase'), onClick: () => emitEditorCommand('to-kebab') },
    { id: 'to-pascal', label: t(uiLanguage, 'titleBar.editPascalCase'), onClick: () => emitEditorCommand('to-pascal') },
  ], [uiLanguage]);

  const editMenuItems = useMemo<MenuItem[]>(() => {
    const base: MenuItem[] = [
      { id: 'copy', label: t(uiLanguage, 'titleBar.editCopy'), shortcut: 'Ctrl+C', onClick: () => emitEditorCommand('copy') },
      { id: 'paste', label: t(uiLanguage, 'titleBar.editPaste'), shortcut: 'Ctrl+V', onClick: () => emitEditorCommand('paste') },
      { id: 'cut', label: t(uiLanguage, 'titleBar.editCut'), shortcut: 'Ctrl+X', onClick: () => emitEditorCommand('cut') },
      { id: 'select-all', label: t(uiLanguage, 'titleBar.editSelectAll'), shortcut: 'Ctrl+A', onClick: () => emitEditorCommand('select-all') },
    ];

    if (hasTextSelection) {
      base.push({ id: 'edit-divider-transform', divider: true });
      base.push({
        id: 'text-transform',
        label: t(uiLanguage, 'titleBar.editTransformSelection'),
        submenu: editTextTransformSubmenu,
      });
    }

    return base;
  }, [editTextTransformSubmenu, hasTextSelection, uiLanguage]);

  const viewMenuItems = useMemo<MenuItem[]>(() => [
    { id: 'toggle-sidebar', label: t(uiLanguage, 'titleBar.viewToggleSidebar'), checked: sidebarVisible, onClick: () => toggleSidebar() },
    { id: 'toggle-bottom', label: t(uiLanguage, 'titleBar.viewToggleBottomPanel'), checked: bottomPanelVisible, onClick: () => togglePanel() },
    { id: 'toggle-ai', label: t(uiLanguage, 'titleBar.viewToggleAIPanel'), checked: aiPanelVisible, onClick: () => toggleAIPanel() },
    { id: 'toggle-activity', label: t(uiLanguage, 'titleBar.viewToggleActivityBar'), checked: activityBarVisible, onClick: () => toggleActivityBar() },
    { id: 'toggle-status', label: t(uiLanguage, 'titleBar.viewToggleStatusBar'), checked: statusBarVisible, onClick: () => toggleStatusBar() },
    { id: 'view-divider-1', divider: true },
    { id: 'show-explorer', label: t(uiLanguage, 'titleBar.viewShowExplorer'), onClick: () => setSidebarPanel('explorer') },
    { id: 'show-search', label: t(uiLanguage, 'titleBar.viewShowSearch'), onClick: () => setSidebarPanel('search') },
    { id: 'show-git', label: t(uiLanguage, 'titleBar.viewShowSourceControl'), onClick: () => setSidebarPanel('git') },
    { id: 'show-database', label: t(uiLanguage, 'titleBar.viewShowDatabase'), onClick: () => setSidebarPanel('database') },
    { id: 'view-divider-2', divider: true },
    { id: 'show-terminal', label: t(uiLanguage, 'titleBar.viewShowTerminal'), onClick: () => setBottomTab('terminal') },
    { id: 'show-problems', label: t(uiLanguage, 'titleBar.viewShowProblems'), onClick: () => setBottomTab('problems') },
    { id: 'show-output', label: t(uiLanguage, 'titleBar.viewShowOutput'), onClick: () => setBottomTab('output') },
    { id: 'show-debug-console', label: t(uiLanguage, 'titleBar.viewShowDebugConsole'), onClick: () => setBottomTab('debug') },
  ], [
    activityBarVisible,
    aiPanelVisible,
    bottomPanelVisible,
    setBottomTab,
    setSidebarPanel,
    sidebarVisible,
    statusBarVisible,
    toggleAIPanel,
    toggleActivityBar,
    togglePanel,
    toggleSidebar,
    toggleStatusBar,
    uiLanguage,
  ]);

  const helpMenuItems = useMemo<MenuItem[]>(() => [
    { id: 'about', label: t(uiLanguage, 'titleBar.helpAbout'), onClick: () => void runAbout() },
    {
      id: 'check-updates',
      label: isCheckingUpdates
        ? t(uiLanguage, 'titleBar.helpCheckingUpdates')
        : t(uiLanguage, 'titleBar.helpCheckUpdates'),
      disabled: isCheckingUpdates,
      onClick: () => void runCheckUpdates(),
    },
  ], [isCheckingUpdates, uiLanguage]);

  const menuMap: Record<MenuId, MenuItem[]> = {
    file: fileMenuItems,
    edit: editMenuItems,
    view: viewMenuItems,
    help: helpMenuItems,
  };

  const menuMapWithMnemonics: Record<MenuId, MenuItemWithMnemonic[]> = useMemo(() => ({
    file: withMnemonics(fileMenuItems),
    edit: withMnemonics(editMenuItems),
    view: withMnemonics(viewMenuItems),
    help: withMnemonics(helpMenuItems),
  }), [editMenuItems, fileMenuItems, helpMenuItems, viewMenuItems]);

  const menuOrder: MenuId[] = ['file', 'edit', 'view', 'help'];

  const getCurrentLevelItems = (): MenuItemWithMnemonic[] => {
    if (!openMenu) return [];
    const rootItems = menuMapWithMnemonics[openMenu] ?? [];
    if (!openSubmenuId) {
      return rootItems.filter((it) => !it.divider);
    }
    const parent = rootItems.find((it) => it.id === openSubmenuId);
    return (parent?.submenu ?? []).filter((it) => !it.divider);
  };

  const activateMenuItem = (item: MenuItemWithMnemonic) => {
    if (item.disabled) return;
    if (item.submenu?.length) {
      setOpenSubmenuId(item.id);
      const firstSub = item.submenu.find((s) => !s.divider);
      setActiveMenuItemId(firstSub?.id ?? null);
      return;
    }
    if (item.onClick) void item.onClick();
    setOpenMenu(null);
    setOpenSubmenuId(null);
    setActiveMenuItemId(null);
    setMnemonicMode(false);
  };

  useEffect(() => {
    if (!openMenu) {
      setActiveMenuItemId(null);
      return;
    }
    const items = getCurrentLevelItems();
    if (items.length === 0) {
      setActiveMenuItemId(null);
      return;
    }
    if (!activeMenuItemId || !items.some((it) => it.id === activeMenuItemId)) {
      const firstEnabled = items.find((it) => !it.disabled) ?? items[0];
      setActiveMenuItemId(firstEnabled.id);
    }
  }, [openMenu, openSubmenuId, activeMenuItemId, menuMapWithMnemonics]);

  const topMenuEntries = useMemo(() => {
    const used = new Set<string>();
    return menuOrder.map((id) => {
      const label = t(uiLanguage, `titleBar.${id}`);
      const mnemonicIndex = pickMnemonicIndex(label, used);
      const mnemonicChar = mnemonicIndex >= 0 ? normalizeMnemonicChar(label[mnemonicIndex]) : '';
      return { id, label, mnemonicIndex, mnemonicChar };
    });
  }, [menuOrder, uiLanguage]);

  useEffect(() => {
    const runMenuItem = (item: MenuItemWithMnemonic) => {
      if (item.disabled) return;
      if (item.submenu?.length) {
        setOpenSubmenuId(item.id);
        return;
      }
      if (item.onClick) void item.onClick();
      setOpenMenu(null);
      setOpenSubmenuId(null);
      setMnemonicMode(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        event.preventDefault();
        setMnemonicMode(true);
        setOpenMenu('file');
        setOpenSubmenuId(null);
        setActiveMenuItemId(null);
        return;
      }

      if (openMenu) {
        const currentItems = getCurrentLevelItems();
        const currentIndex = currentItems.findIndex((it) => it.id === activeMenuItemId);

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (currentItems.length === 0) return;
          const nextIdx = currentIndex < 0 ? 0 : (currentIndex + 1) % currentItems.length;
          setActiveMenuItemId(currentItems[nextIdx].id);
          return;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (currentItems.length === 0) return;
          const nextIdx = currentIndex < 0
            ? currentItems.length - 1
            : (currentIndex - 1 + currentItems.length) % currentItems.length;
          setActiveMenuItemId(currentItems[nextIdx].id);
          return;
        }

        if (event.key === 'ArrowRight') {
          event.preventDefault();
          const activeItem = currentItems.find((it) => it.id === activeMenuItemId);
          if (activeItem?.submenu?.length) {
            setOpenSubmenuId(activeItem.id);
            const first = activeItem.submenu.find((s) => !s.divider && !s.disabled) || activeItem.submenu.find((s) => !s.divider);
            setActiveMenuItemId(first?.id ?? null);
            return;
          }
          const menuIdx = openMenu ? menuOrder.indexOf(openMenu) : 0;
          const nextMenu = menuOrder[(menuIdx + 1) % menuOrder.length];
          setOpenMenu(nextMenu);
          setOpenSubmenuId(null);
          setActiveMenuItemId(null);
          return;
        }

        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          if (openSubmenuId) {
            setActiveMenuItemId(openSubmenuId);
            setOpenSubmenuId(null);
            return;
          }
          const menuIdx = openMenu ? menuOrder.indexOf(openMenu) : 0;
          const prevMenu = menuOrder[(menuIdx - 1 + menuOrder.length) % menuOrder.length];
          setOpenMenu(prevMenu);
          setOpenSubmenuId(null);
          setActiveMenuItemId(null);
          return;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          const activeItem = currentItems.find((it) => it.id === activeMenuItemId);
          if (!activeItem) return;
          activateMenuItem(activeItem);
          return;
        }
      }

      if (event.altKey && event.key.length === 1) {
        const key = normalizeMnemonicChar(event.key);
        const match = topMenuEntries.find((entry) => entry.mnemonicChar === key);
        if (match) {
          event.preventDefault();
          setOpenMenu(match.id);
          setOpenSubmenuId(null);
          setActiveMenuItemId(null);
          setMnemonicMode(true);
        }
        return;
      }

      if (!mnemonicMode) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1) return;
      if (!openMenu) return;

      const key = normalizeMnemonicChar(event.key);

      const topMenuMatch = topMenuEntries.find((entry) => entry.mnemonicChar === key);
      if (topMenuMatch) {
        event.preventDefault();
        setOpenMenu(topMenuMatch.id);
        setOpenSubmenuId(null);
        setActiveMenuItemId(null);
        return;
      }

      const currentLevelItems = (() => {
        const rootItems = menuMapWithMnemonics[openMenu] ?? [];
        if (!openSubmenuId) return rootItems;
        const parent = rootItems.find((i) => i.id === openSubmenuId);
        return parent?.submenu ?? rootItems;
      })();

      const itemMatch = currentLevelItems.find((item) => item.mnemonicChar === key);
      if (itemMatch) {
        event.preventDefault();
        setActiveMenuItemId(itemMatch.id);
        activateMenuItem(itemMatch);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeMenuItemId, menuMapWithMnemonics, mnemonicMode, openMenu, openSubmenuId, topMenuEntries]);

  const renderMenuItems = (items: MenuItemWithMnemonic[], parentId: string) => (
    <div className="dropdown-menu min-w-65 pt-1 pb-1">
      {items.map((item) => {
        if (item.divider) {
          return <div key={item.id} className="h-px my-1 bg-quebracho-border/60" />;
        }

        const itemHasSubmenu = !!item.submenu?.length;
        const submenuOpen = openSubmenuId === item.id;
        const rowClass = item.disabled
          ? 'text-quebracho-text/35 cursor-default'
          : item.id === activeMenuItemId
            ? 'text-quebracho-accent bg-quebracho-accent/15'
            : 'text-quebracho-text-menu hover:bg-quebracho-accent/10 hover:text-quebracho-accent';

        return (
          <div
            key={item.id}
            className={`relative flex items-center justify-between pl-3 pr-3 pt-1 pb-1.5 text-[12px] ${rowClass}`}
            onMouseEnter={() => {
              setActiveMenuItemId(item.id);
              if (itemHasSubmenu) setOpenSubmenuId(item.id);
              else setOpenSubmenuId(null);
            }}
            onClick={() => {
              if (item.disabled) return;
              if (itemHasSubmenu) {
                setOpenSubmenuId(item.id);
                setActiveMenuItemId(item.id);
                return;
              }
              if (item.onClick) {
                void item.onClick();
              }
              setOpenMenu(null);
              setOpenSubmenuId(null);
              setActiveMenuItemId(null);
              setMnemonicMode(false);
            }}
          >
            <div className="flex items-center gap-2">
              <span className="w-3 inline-flex items-center justify-center">
                {item.checked ? <Check size={12} /> : null}
              </span>
              {renderMnemonicLabel(item.label || '', item.mnemonicIndex, mnemonicMode)}
            </div>

            <div className="flex items-center gap-2 text-[11px] opacity-70">
              {item.shortcut ? <span>{item.shortcut}</span> : null}
              {itemHasSubmenu ? <ChevronRight size={12} /> : null}
            </div>

            {itemHasSubmenu && submenuOpen ? (
              <div className="absolute top-0 left-full ml-1 z-[120]">
                {renderMenuItems(item.submenu || [], `${parentId}-${item.id}`)}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="h-8 bg-quebracho-titlebar flex items-center justify-between select-none drag-region border-b border-quebracho-border/40 relative">
      {/* Left: Logo + App name + Menu */}
      <div className="flex items-center h-full no-drag" ref={menuRootRef}>
        {/* Logo + Quebracho */}
        <div className="flex items-center gap-2 pl-3 pr-3 h-full">
          <img src={logoUrl} alt="Quebracho" className="h-5 w-auto object-contain" />
        </div>

        {/* Menu Items */}
        <div className="flex items-center h-full text-[13px] ml-1">
          {topMenuEntries.map((menuEntry) => {
            const menuId = menuEntry.id;
            const isOpen = openMenu === menuId;
            return (
              <div
                key={menuId}
                className="relative h-full"
                onMouseEnter={() => {
                  if (openMenu) {
                    setOpenMenu(menuId);
                    setOpenSubmenuId(null);
                    setActiveMenuItemId(null);
                  }
                }}
              >
                <button
                  onClick={() => {
                    setOpenMenu((current) => (current === menuId ? null : menuId));
                    setOpenSubmenuId(null);
                    setActiveMenuItemId(null);
                    setMnemonicMode(false);
                  }}
                  className={`pl-3 pr-3 h-full transition-colors ${
                    isOpen
                      ? 'text-quebracho-text-strong bg-quebracho-hover'
                      : 'text-quebracho-text hover:text-quebracho-text-strong hover:bg-quebracho-hover'
                  }`}
                >
                  {renderMnemonicLabel(menuEntry.label, menuEntry.mnemonicIndex, mnemonicMode)}
                </button>

                {isOpen ? (
                  <div className="absolute top-full left-0 z-[110] pt-1">
                    {renderMenuItems(menuMapWithMnemonics[menuId], menuId)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Center: Workspace title */}
      <div className="absolute left-1/2 -translate-x-1/2 text-[12px] text-quebracho-text/70 pointer-events-none">
        {workspaceName ? `${workspaceName} — Quebracho` : 'Quebracho'}
      </div>

      {/* Right: Window Controls */}
      <div className="flex items-center h-full no-drag">
        <button
          onClick={handleMinimize}
          className="w-[2.875rem] h-full flex items-center justify-center hover:bg-white/10 transition-colors"
        >
          <Minus size={16} className="text-quebracho-text" />
        </button>
        <button
          onClick={handleMaximize}
          className="w-[2.875rem] h-full flex items-center justify-center hover:bg-white/10 transition-colors"
        >
          {isMaximized ? (
            <Copy size={12} className="text-quebracho-text" />
          ) : (
            <Square size={12} className="text-quebracho-text" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="w-[2.875rem] h-full flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
        >
          <X size={16} className="text-quebracho-text" />
        </button>
      </div>
    </div>
  );
}
