import { useStore } from '../store';
import { t } from '../i18n';
import { X } from 'lucide-react';
import { colorThemeOptions, fileIconThemeOptions } from '../theme/appearance';

export default function SettingsModal() {
  const open = useStore((s) => s.settingsModalOpen);
  const setOpen = useStore((s) => s.setSettingsModalOpen);
  const uiLanguage = useStore((s) => s.uiLanguage);
  const setUILanguage = useStore((s) => s.setUILanguage);
  const terminalShellPreference = useStore((s) => s.terminalShellPreference);
  const setTerminalShellPreference = useStore((s) => s.setTerminalShellPreference);
  const colorTheme = useStore((s) => s.colorTheme);
  const setColorTheme = useStore((s) => s.setColorTheme);
  const fileIconTheme = useStore((s) => s.fileIconTheme);
  const setFileIconTheme = useStore((s) => s.setFileIconTheme);

  const platform = (() => {
    const raw = (typeof navigator !== 'undefined' ? navigator.platform : '').toLowerCase();
    if (raw.includes('win')) return 'windows';
    if (raw.includes('mac')) return 'macos';
    return 'linux';
  })();

  const shellOptions = (() => {
    if (platform === 'windows') {
      return [
        { value: 'auto', label: t(uiLanguage, 'settings.shellAuto') },
        { value: 'pwsh', label: t(uiLanguage, 'settings.shellPwsh') },
        { value: 'powershell', label: t(uiLanguage, 'settings.shellPowerShell') },
        { value: 'cmd', label: t(uiLanguage, 'settings.shellCmd') },
        { value: 'git-bash', label: t(uiLanguage, 'settings.shellGitBash') },
      ];
    }

    if (platform === 'macos') {
      return [
        { value: 'auto', label: t(uiLanguage, 'settings.shellAuto') },
        { value: 'zsh', label: t(uiLanguage, 'settings.shellZsh') },
        { value: 'bash', label: t(uiLanguage, 'settings.shellBash') },
        { value: 'sh', label: t(uiLanguage, 'settings.shellSh') },
        { value: 'fish', label: t(uiLanguage, 'settings.shellFish') },
      ];
    }

    return [
      { value: 'auto', label: t(uiLanguage, 'settings.shellAuto') },
      { value: 'bash', label: t(uiLanguage, 'settings.shellBash') },
      { value: 'zsh', label: t(uiLanguage, 'settings.shellZsh') },
      { value: 'sh', label: t(uiLanguage, 'settings.shellSh') },
      { value: 'fish', label: t(uiLanguage, 'settings.shellFish') },
    ];
  })();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[96px] bg-black/55"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[520px] bg-quebracho-sidebar border border-quebracho-border rounded-md shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-quebracho-border/60">
          <h2 className="text-[14px] font-medium text-quebracho-text-strong">{t(uiLanguage, 'settings.title')}</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-quebracho-text hover:text-quebracho-text-strong transition-colors"
            title={t(uiLanguage, 'settings.close')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-5">
          <div>
            <p className="text-[13px] text-quebracho-text-strong mb-1">{t(uiLanguage, 'settings.colorThemeSection')}</p>
            <p className="text-[12px] text-quebracho-text/65 mb-3">{t(uiLanguage, 'settings.colorThemeDescription')}</p>
            <select
              value={colorTheme}
              onChange={(e) => {
                void setColorTheme(e.target.value as typeof colorTheme);
              }}
              className="w-full rounded border border-quebracho-border bg-quebracho-bg px-3 py-2 text-[13px] text-quebracho-text-strong focus:outline-none focus:ring-1 focus:ring-quebracho-accent"
            >
              {colorThemeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(uiLanguage, opt.labelKey)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-[13px] text-quebracho-text-strong mb-1">{t(uiLanguage, 'settings.fileIconThemeSection')}</p>
            <p className="text-[12px] text-quebracho-text/65 mb-3">{t(uiLanguage, 'settings.fileIconThemeDescription')}</p>
            <select
              value={fileIconTheme}
              onChange={(e) => {
                void setFileIconTheme(e.target.value as typeof fileIconTheme);
              }}
              className="w-full rounded border border-quebracho-border bg-quebracho-bg px-3 py-2 text-[13px] text-quebracho-text-strong focus:outline-none focus:ring-1 focus:ring-quebracho-accent"
            >
              {fileIconThemeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(uiLanguage, opt.labelKey)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-[13px] text-quebracho-text-strong mb-1">{t(uiLanguage, 'settings.terminalSection')}</p>
            <p className="text-[12px] text-quebracho-text/65 mb-3">{t(uiLanguage, 'settings.terminalDescription')}</p>
            <select
              value={terminalShellPreference}
              onChange={(e) => {
                void setTerminalShellPreference(e.target.value);
              }}
              className="w-full rounded border border-quebracho-border bg-quebracho-bg px-3 py-2 text-[13px] text-quebracho-text-strong focus:outline-none focus:ring-1 focus:ring-quebracho-accent"
            >
              {shellOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-quebracho-text/55 mt-2">{t(uiLanguage, 'settings.terminalRestartHint')}</p>
          </div>

          <div>
          <p className="text-[13px] text-quebracho-text-strong mb-1">{t(uiLanguage, 'settings.languageSection')}</p>
          <p className="text-[12px] text-quebracho-text/65 mb-3">{t(uiLanguage, 'settings.languageDescription')}</p>

          <div className="space-y-2">
            <button
              onClick={() => {
                void setUILanguage('es');
              }}
              className={`w-full text-left px-3 py-2 rounded border transition-colors ${
                uiLanguage === 'es'
                  ? 'border-quebracho-accent bg-quebracho-accent/12 text-quebracho-accent'
                  : 'border-quebracho-border text-quebracho-text hover:border-quebracho-accent/55 hover:text-quebracho-text-strong'
              }`}
            >
              {t(uiLanguage, 'settings.spanish')}
            </button>

            <button
              onClick={() => {
                void setUILanguage('en');
              }}
              className={`w-full text-left px-3 py-2 rounded border transition-colors ${
                uiLanguage === 'en'
                  ? 'border-quebracho-accent bg-quebracho-accent/12 text-quebracho-accent'
                  : 'border-quebracho-border text-quebracho-text hover:border-quebracho-accent/55 hover:text-quebracho-text-strong'
              }`}
            >
              {t(uiLanguage, 'settings.english')}
            </button>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
