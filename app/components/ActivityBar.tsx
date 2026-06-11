import { useStore } from '../store';
import { Files, Search, GitBranch, Database, Settings, UserCircle, Sparkles } from 'lucide-react';
import type { SidebarPanel } from '../types';
import { t } from '../i18n';

interface ActivityItem {
  id: SidebarPanel;
  icon: React.ReactNode;
  title: string;
}

const items: ActivityItem[] = [
  { id: 'explorer', icon: <Files size={18} />, title: 'activity.explorer' },
  { id: 'search', icon: <Search size={18} />, title: 'activity.search' },
  { id: 'git', icon: <GitBranch size={18} />, title: 'activity.sourceControl' },
  { id: 'database', icon: <Database size={18} />, title: 'activity.database' },
];

export default function ActivityBar() {
  const activeSidebarPanel = useStore((s) => s.activeSidebarPanel);
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const setSidebarPanel = useStore((s) => s.setSidebarPanel);
  const aiPanelVisible = useStore((s) => s.aiPanelVisible);
  const toggleAIPanel = useStore((s) => s.toggleAIPanel);
  const setSettingsModalOpen = useStore((s) => s.setSettingsModalOpen);
  const uiLanguage = useStore((s) => s.uiLanguage);
  const handleAccountClick = () => {
    alert(t(uiLanguage, 'activity.accountUnavailable'));
  };

  return (
    <div className="h-[40px] w-full bg-quebracho-activitybar flex items-center justify-between px-2 border-b border-quebracho-border/50 select-none">
      {/* Left: panel icons (horizontal) */}
      <div className="flex items-center h-full">
        {items.map((item) => {
          const isActive = activeSidebarPanel === item.id && sidebarVisible;
          return (
            <button
              key={item.id}
              onClick={() => setSidebarPanel(item.id)}
              title={t(uiLanguage, item.title)}
              className={`relative h-full px-4 flex items-center justify-center transition-colors
                ${isActive
                  ? 'text-quebracho-text-strong'
                  : 'text-quebracho-text hover:text-quebracho-text-strong'}
              `}
            >
              {item.icon}
              {/* Active bottom border accent */}
              {isActive && (
                <span className="absolute left-2 right-2 bottom-0 h-[2px] bg-quebracho-accent rounded-t" />
              )}
            </button>
          );
        })}
      </div>

      {/* Right: utility icons */}
      <div className="flex items-center h-full">
        <button
          onClick={toggleAIPanel}
          title={t(uiLanguage, 'activity.aiAgent')}
          className={`relative h-full px-3 flex items-center justify-center transition-colors
            ${aiPanelVisible
              ? 'text-quebracho-text-strong'
              : 'text-quebracho-text hover:text-quebracho-text-strong'}
          `}
        >
          <Sparkles size={18} />
          {aiPanelVisible && (
            <span className="absolute left-2 right-2 bottom-0 h-[2px] bg-quebracho-accent rounded-t" />
          )}
        </button>
        <button
          onClick={handleAccountClick}
          title={t(uiLanguage, 'activity.account')}
          className="h-full px-3 flex items-center justify-center text-quebracho-text hover:text-quebracho-text-strong transition-colors"
        >
          <UserCircle size={18} />
        </button>
        <button
          onClick={() => setSettingsModalOpen(true)}
          title={t(uiLanguage, 'activity.settings')}
          className="h-full px-3 flex items-center justify-center text-quebracho-text hover:text-quebracho-text-strong transition-colors"
        >
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
}
