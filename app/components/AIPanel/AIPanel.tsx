import { useEffect, useRef, useState } from 'react';
import { Plus, ChevronDown, Sparkles, Check, Settings2 } from 'lucide-react';
import { useStore } from '../../store';
import ApiKeyModal from './ApiKeyModal';
import ChatMessages from './ChatMessages';
import InputArea from './InputArea';
import DiffView from './DiffView';
import type { ProviderId, ProviderInfo } from '../../types';
import { t } from '../../i18n';

/** Provider id → human-readable name lookup. Falls back to capitalising the id. */
function providerDisplayName(
  id: ProviderId,
  providers: ProviderInfo[] | null,
): string {
  const found = providers?.find((p) => p.id === id);
  if (found) return found.name;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Three pulsing dots used as a skeleton while model lists load. */
function SkeletonDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <span className="w-1.5 h-1.5 rounded-full bg-quebracho-text-dim animate-pulse" />
      <span className="w-1.5 h-1.5 rounded-full bg-quebracho-text-dim animate-pulse" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-quebracho-text-dim animate-pulse" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

/** Top bar: shows the active provider/model on the left and the "+" key
 *  button on the right. Clicking the model name opens the picker dropdown,
 *  which lets the user switch between already-configured providers and
 *  pick a different model. */
function TopBar() {
  const uiLanguage = useStore((s) => s.uiLanguage);
  const activeProvider = useStore((s) => s.aiActiveProvider);
  const activeModel = useStore((s) => s.aiActiveModel);
  const availableModels = useStore((s) => s.aiAvailableModels);
  const modelLoadStatus = useStore((s) => s.aiModelLoadStatus);
  const configuredProviders = useStore((s) => s.aiConfiguredProviders);
  const setActive = useStore((s) => s.setAIActive);
  const setApiKeyModalOpen = useStore((s) => s.setAIApiKeyModalOpen);
  const refreshAIConfig = useStore((s) => s.refreshAIConfig);
  const setAvailableModels = useStore((s) => s.setAIAvailableModels);
  const setModelLoadStatus = useStore((s) => s.setAIModelLoadStatus);
  const menuOpen = useStore((s) => s.aiModelMenuOpen);
  const setMenuOpen = useStore((s) => s.setAIModelMenuOpen);

  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Hydrate provider list + active config from the main process when this
  // component first mounts.
  useEffect(() => {
    window.forgeAPI.ai
      .listProviders()
      .then((p) => setProviders(p as ProviderInfo[]))
      .catch(() => setProviders([]));
    void refreshAIConfig();
  }, [refreshAIConfig]);

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen, setMenuOpen]);

  /** Determine whether the given provider should show a base-URL input. */
  const showsBaseUrl = (pid: ProviderId): boolean => {
    if (pid === 'ollama') return true;
    const info = providers?.find((p) => p.id === pid);
    if (info?.hint?.toLowerCase().includes('openai-compatible')) return true;
    return false;
  };

  /** Ensure the model list for `provider` is loaded into `availableModels`.
   *  Returns the resolved list (or [] on error). */
  const ensureModelsLoaded = async (provider: ProviderId): Promise<string[]> => {
    if (availableModels[provider] && availableModels[provider]!.length > 0) {
      return availableModels[provider]!;
    }
    setModelLoadStatus(provider, 'loading');
    try {
      const models = await window.forgeAPI.ai.listModels(provider);
      setAvailableModels(provider, models);
      setModelLoadStatus(provider, 'success');
      return models;
    } catch (err) {
      console.warn('[quebracho] listModels failed for', provider, (err as Error)?.message);
      setModelLoadStatus(provider, 'error');
      return [];
    }
  };

  // When the dropdown opens, lazily fetch the active provider's model list.
  useEffect(() => {
    if (!menuOpen || !activeProvider) return;
    if (availableModels[activeProvider]) return;
    void ensureModelsLoaded(activeProvider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, activeProvider]);

  const handleSelectModel = async (model: string) => {
    if (!activeProvider) return;
    console.debug('[quebracho:ai] TopBar select model →', activeProvider, model);
    await setActive(activeProvider, model);
    setMenuOpen(false);
  };

  /** Switch to another configured provider. Loads its model list and
   *  auto-selects the first model. */
  const handleSwitchProvider = async (provider: ProviderId) => {
    if (provider === activeProvider) return;
    console.debug('[quebracho:ai] TopBar switch provider →', provider);
    const models = await ensureModelsLoaded(provider);
    const first = models[0] || '';
    if (!first) {
      console.warn('[quebracho] no models for provider', provider);
      // Still set provider so the UI reflects the switch; user can pick a
      // model from the dropdown manually once it loads.
      await setActive(provider, '');
      return;
    }
    await setActive(provider, first);
  };

  const handleBaseUrlChange = (pid: ProviderId, url: string) => {
    setBaseUrlInput(url);
    if (url.trim()) {
      void window.forgeAPI.ai.setProviderBaseUrl(pid, url.trim());
    }
  };

  const models = activeProvider ? availableModels[activeProvider] || [] : [];
  const loadStatus = activeProvider ? modelLoadStatus[activeProvider] : 'idle';

  return (
    <div className="h-[40px] flex items-center justify-between px-3 border-b border-quebracho-border select-none flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0 relative" ref={dropdownRef}>
        <Sparkles size={14} className="text-quebracho-accent flex-shrink-0" />
        {activeProvider && activeModel ? (
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-1.5 text-quebracho-text-strong text-[13px] hover:opacity-90 min-w-0"
            title={t(uiLanguage, 'aiPanel.changeProviderModel')}
          >
            <span className="flex-shrink-0">
              {providerDisplayName(activeProvider, providers)}
            </span>
            <span className="text-quebracho-text-dim">·</span>
            <span className="truncate">{activeModel}</span>
            <ChevronDown size={12} className="text-quebracho-text-dim flex-shrink-0" />
          </button>
        ) : (
          <span className="text-quebracho-text-dim text-[13px]">{t(uiLanguage, 'aiPanel.agentWithoutModel')}</span>
        )}

        {menuOpen && activeProvider && (
          <div
            className="dropdown-menu absolute top-9 left-0 z-50 min-w-[260px] max-h-[440px] overflow-y-auto sidebar-scroll"
          >
            {/* Section 1: switch between configured providers */}
            {configuredProviders.length > 1 && (
              <>
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-quebracho-text-dim border-b border-quebracho-border/60">
                  {t(uiLanguage, 'aiPanel.activeProvider')}
                </div>
                {configuredProviders.map((pid) => {
                  const isActive = pid === activeProvider;
                  return (
                    <button
                      key={pid}
                      onClick={() => handleSwitchProvider(pid)}
                      className={`flex items-center justify-between w-full text-left px-3 py-1.5 text-[12px] transition-colors
                        ${isActive
                          ? 'bg-quebracho-accent/15 text-quebracho-accent'
                          : 'text-quebracho-text-menu hover:bg-quebracho-accent/10 hover:text-quebracho-accent'}
                      `}
                    >
                      <span>{providerDisplayName(pid, providers)}</span>
                      {isActive && <Check size={12} className="flex-shrink-0" />}
                    </button>
                  );
                })}
              </>
            )}

            {/* Section 2: model picker for the active provider */}
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-quebracho-text-dim border-b border-t border-quebracho-border/60">
              {t(uiLanguage, 'aiPanel.modelsOf', {
                provider: providerDisplayName(activeProvider, providers),
              })}
            </div>
            {loadStatus === 'loading' && <SkeletonDots />}
            {loadStatus === 'error' && (
              <div className="px-3 py-2">
                <div className="text-[11px] text-red-400">
                  {t(uiLanguage, 'aiPanel.discoveryFailed')}
                </div>
                <div className="text-[10px] text-quebracho-text-dim mt-0.5">
                  {t(uiLanguage, 'aiPanel.usingStaticList')}
                </div>
              </div>
            )}
            {loadStatus !== 'loading' && models.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-quebracho-text-dim">
                {t(uiLanguage, 'aiPanel.noModels')}
              </div>
            )}
            {models.map((m) => (
              <button
                key={m}
                onClick={() => handleSelectModel(m)}
                className={`flex items-center justify-between w-full text-left px-3 py-1.5 text-[12px] transition-colors
                  ${m === activeModel
                    ? 'bg-quebracho-accent/15 text-quebracho-accent'
                    : 'text-quebracho-text-menu hover:bg-quebracho-accent/10 hover:text-quebracho-accent'}
                `}
              >
                <span className="truncate">{m}</span>
                {m === activeModel && <Check size={12} className="flex-shrink-0 ml-2" />}
              </button>
            ))}

            {/* Optional base-URL input for Ollama / custom providers */}
            {activeProvider && showsBaseUrl(activeProvider) && (
              <div className="border-t border-quebracho-border/60 px-3 py-2">
                <label className="block text-[10px] text-quebracho-text-dim mb-1">
                  {t(uiLanguage, 'aiPanel.baseUrl')}
                </label>
                <input
                  type="text"
                  placeholder="http://localhost:11434"
                  value={baseUrlInput}
                  onChange={(e) => handleBaseUrlChange(activeProvider, e.target.value)}
                  className="quebracho-input w-full text-[12px]"
                />
                <p className="mt-1 text-[10px] text-quebracho-text-dim">
                  {t(uiLanguage, 'aiPanel.baseUrlHint')}
                </p>
              </div>
            )}

            {/* Section 3: footer → open the API-key manager */}
            <div className="border-t border-quebracho-border/60">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setApiKeyModalOpen(true);
                }}
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-[12px] text-quebracho-text-menu hover:bg-quebracho-accent/10 hover:text-quebracho-accent transition-colors"
              >
                <Settings2 size={13} />
                {t(uiLanguage, 'aiPanel.manageApiKeys')}
              </button>
            </div>
          </div>
        )}
      </div>
      <button
        onClick={() => setApiKeyModalOpen(true)}
        title={t(uiLanguage, 'aiPanel.addOrChangeApiKey')}
        className="h-7 w-7 rounded flex items-center justify-center text-quebracho-text hover:text-quebracho-text-strong hover:bg-white/5"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

/** Empty / "no provider configured" state shown center-panel. */
function EmptyState() {
  const uiLanguage = useStore((s) => s.uiLanguage);
  const setApiKeyModalOpen = useStore((s) => s.setAIApiKeyModalOpen);
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-4">
      <Sparkles size={36} className="text-quebracho-accent" />
      <h2 className="text-2xl font-light text-quebracho-text-strong tracking-wide">
        {t(uiLanguage, 'aiPanel.emptyTitle')}
      </h2>
      <p className="text-[12px] text-quebracho-text-dim leading-relaxed max-w-[260px]">
        {t(uiLanguage, 'aiPanel.emptyDescription')}
      </p>
      <button
        onClick={() => setApiKeyModalOpen(true)}
        className="px-4 py-2 rounded bg-quebracho-accent text-black text-[13px] font-medium hover:opacity-90"
      >
        {t(uiLanguage, 'aiPanel.emptyCta')}
      </button>
    </div>
  );
}

/** Banner shown when /init has not been run yet for the current workspace. */
function NoInitBanner() {
  const uiLanguage = useStore((s) => s.uiLanguage);
  return (
    <div className="px-3 py-2 text-[12px] text-quebracho-accent border-b border-quebracho-border bg-quebracho-accent/5">
      {t(uiLanguage, 'aiPanel.initBanner')}
    </div>
  );
}

export default function AIPanel() {
  const activeProvider = useStore((s) => s.aiActiveProvider);
  const activeModel = useStore((s) => s.aiActiveModel);
  const workspacePath = useStore((s) => s.workspacePath);
  const initDone = useStore((s) => s.aiInitDone);
  const messages = useStore((s) => s.aiMessages);
  const refreshAIConfig = useStore((s) => s.refreshAIConfig);

  // Hydrate config on mount.
  useEffect(() => {
    void refreshAIConfig();
  }, [refreshAIConfig]);

  const providerReady = !!(activeProvider && activeModel);

  return (
    <div className="h-full w-full flex flex-col bg-quebracho-sidebar text-quebracho-text">
      <TopBar />
      {!providerReady ? (
        <EmptyState />
      ) : (
        <>
          {workspacePath && !initDone && messages.length === 0 && <NoInitBanner />}
          <ChatMessages />
        </>
      )}
      <InputArea />
      <ApiKeyModal />
      <DiffView />
    </div>
  );
}
