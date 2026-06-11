import { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '../store';
import type { Command } from '../types';
import { t } from '../i18n';

export default function CommandPalette() {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const setCommandPaletteOpen = useStore((s) => s.setCommandPaletteOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const togglePanel = useStore((s) => s.togglePanel);
  const openFolder = useStore((s) => s.openFolder);
  const saveFile = useStore((s) => s.saveFile);
  const setSidebarPanel = useStore((s) => s.setSidebarPanel);
  const setSettingsModalOpen = useStore((s) => s.setSettingsModalOpen);
  const uiLanguage = useStore((s) => s.uiLanguage);

  const close = () => setCommandPaletteOpen(false);

  const commands: Command[] = useMemo(
    () => [
      { id: 'open-folder', label: t(uiLanguage, 'commandPalette.fileOpenFolder'), action: () => { openFolder(); close(); } },
      { id: 'save-file', label: t(uiLanguage, 'commandPalette.fileSave'), shortcut: 'Ctrl+S', action: () => { saveFile(); close(); } },
      { id: 'toggle-sidebar', label: t(uiLanguage, 'commandPalette.viewToggleSidebar'), shortcut: 'Ctrl+B', action: () => { toggleSidebar(); close(); } },
      { id: 'toggle-panel', label: t(uiLanguage, 'commandPalette.viewTogglePanel'), shortcut: 'Ctrl+`', action: () => { togglePanel(); close(); } },
      { id: 'show-explorer', label: t(uiLanguage, 'commandPalette.viewShowExplorer'), action: () => { setSidebarPanel('explorer'); close(); } },
      { id: 'show-search', label: t(uiLanguage, 'commandPalette.viewShowSearch'), action: () => { setSidebarPanel('search'); close(); } },
      { id: 'show-git', label: t(uiLanguage, 'commandPalette.viewShowSourceControl'), action: () => { setSidebarPanel('git'); close(); } },
      { id: 'show-database', label: t(uiLanguage, 'commandPalette.viewShowDatabase'), action: () => { setSidebarPanel('database'); close(); } },
      { id: 'open-settings', label: t(uiLanguage, 'commandPalette.openSettings'), action: () => { setSettingsModalOpen(true); close(); } },
    ],
    [
      openFolder,
      saveFile,
      setSettingsModalOpen,
      setSidebarPanel,
      togglePanel,
      toggleSidebar,
      uiLanguage,
    ]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const lower = query.toLowerCase();
    return commands.filter((cmd) => cmd.label.toLowerCase().includes(lower));
  }, [query, commands]);

  useEffect(() => { setSelectedIndex(0); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) filtered[selectedIndex].action();
    }
  };

  return (
    <div
      className="command-palette-overlay fixed inset-0 z-50 flex justify-center pt-[80px]"
      onClick={close}
    >
      <div
        className="w-[600px] max-h-[400px] bg-quebracho-sidebar border border-quebracho-border rounded-md shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-2 border-b border-quebracho-border/50">
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-quebracho-input text-quebracho-text text-[14px] px-3 py-1.5 rounded outline-none border border-quebracho-accent/50 focus:border-quebracho-accent"
            placeholder={t(uiLanguage, 'commandPalette.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="flex-1 overflow-y-auto sidebar-scroll">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-quebracho-text/60 text-sm">
              {t(uiLanguage, 'commandPalette.noMatches')}
            </div>
          ) : (
            filtered.map((cmd, idx) => (
              <div
                key={cmd.id}
                onClick={() => cmd.action()}
                className={`flex items-center justify-between px-4 py-2 cursor-pointer text-[13px] transition-colors
                  ${idx === selectedIndex
                    ? 'bg-quebracho-accent/15 text-quebracho-accent'
                    : 'text-quebracho-text hover:bg-white/5'}
                `}
              >
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <span className="text-quebracho-text/50 text-[12px] ml-4 flex-shrink-0">
                    {cmd.shortcut}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
