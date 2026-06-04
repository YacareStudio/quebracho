import { useEffect, useRef, useState } from 'react';
import { X, KeyRound, Loader2, Check, Trash2 } from 'lucide-react';
import { useStore } from '../../store';
import type { ProviderId, ProviderInfo } from '../../types';
import { t } from '../../i18n';

/**
 * Modal for configuring / changing API keys. The flow:
 *   1. User picks a provider from a list.
 *   2. User types the API key.
 *   3. We persist the key (main process) and immediately query the provider
 *      for the list of available models.
 *   4. User picks a model. We set it as the active provider/model and close
 *      the modal.
 */
export default function ApiKeyModal() {
  const uiLanguage = useStore((s) => s.uiLanguage);
  const open = useStore((s) => s.aiApiKeyModalOpen);
  const setOpen = useStore((s) => s.setAIApiKeyModalOpen);
  const configuredProviders = useStore((s) => s.aiConfiguredProviders);
  const availableModels = useStore((s) => s.aiAvailableModels);
  const setAvailableModels = useStore((s) => s.setAIAvailableModels);
  const refreshAIConfig = useStore((s) => s.refreshAIConfig);
  const setActive = useStore((s) => s.setAIActive);
  const removeProvider = useStore((s) => s.removeAIProvider);
  const activeProvider = useStore((s) => s.aiActiveProvider);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [loadingModels, setLoadingModels] = useState(false);
  /** Provider currently shown in the "are you sure?" confirm-delete UI. */
  const [confirmDelete, setConfirmDelete] = useState<ProviderId | null>(null);
  const keyringStatus = useStore((s) => s.aiKeyringStatus);

  const inputRef = useRef<HTMLInputElement>(null);

  // Load the static providers list once.
  useEffect(() => {
    if (!open) return;
    window.forgeAPI.ai
      .listProviders()
      .then((ps) => setProviders(ps as ProviderInfo[]))
      .catch(() => setProviders([]));
  }, [open]);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (open) {
      setSelectedProvider(activeProvider || null);
      setApiKey('');
      setError(null);
      setModels([]);
      setSelectedModel('');
      setLoadingModels(false);
      setSaving(false);
      setConfirmDelete(null);
      // Focus the API key input shortly after the modal renders.
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, activeProvider]);

  /** Removes the API key for the given provider after user confirmation. */
  const handleDeleteProvider = async (provider: ProviderId) => {
    try {
      await removeProvider(provider);
      await refreshAIConfig();
      setConfirmDelete(null);
      // If the user just removed the provider they had selected in the
      // top-right "Add key" flow, reset that selection too.
      if (selectedProvider === provider) {
        setSelectedProvider(null);
        setModels([]);
        setSelectedModel('');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // If the currently-selected provider already has a known model list (e.g.
  // returned from a previous /listModels call earlier in the session) show
  // it. If the provider is already configured but we don't have a cached
  // model list, fetch it automatically so the user can pick a different
  // model without re-entering the key.
  useEffect(() => {
    if (!selectedProvider) {
      setModels([]);
      setSelectedModel('');
      return;
    }
    const cached = availableModels[selectedProvider];
    if (cached && cached.length > 0) {
      setModels(cached);
      // Pre-select something sensible: the active model if the user is editing
      // the currently-active provider, otherwise the first model in the list.
      setSelectedModel((cur) => {
        if (cur) return cur;
        // For currently-active provider, prefer the active model.
        const activeModel = useStore.getState().aiActiveModel;
        if (activeProvider === selectedProvider && activeModel && cached.includes(activeModel)) {
          return activeModel;
        }
        return cached[0];
      });
      return;
    }
    if (configuredProviders.includes(selectedProvider)) {
      // Auto-fetch models for already-configured providers.
      setLoadingModels(true);
      window.forgeAPI.ai
        .listModels(selectedProvider)
        .then((m) => {
          setAvailableModels(selectedProvider, m);
          setModels(m);
          if (m.length > 0) setSelectedModel(m[0]);
        })
        .catch((err) => setError((err as Error).message))
        .finally(() => setLoadingModels(false));
    } else {
      setModels([]);
      setSelectedModel('');
    }
  }, [selectedProvider, availableModels, configuredProviders, activeProvider, setAvailableModels]);

  if (!open) return null;

  const handleSaveKey = async () => {
    if (!selectedProvider || !apiKey.trim()) {
      setError(t(uiLanguage, 'aiPanel.errorSelectProviderAndKey'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await window.forgeAPI.ai.setApiKey(selectedProvider, apiKey.trim());
      await refreshAIConfig();
      setLoadingModels(true);
      const m = await window.forgeAPI.ai.listModels(selectedProvider);
      setAvailableModels(selectedProvider, m);
      setModels(m);
      // Pre-select the first model so the user only has to click "Activar".
      if (m.length > 0) setSelectedModel(m[0]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingModels(false);
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    if (!selectedProvider || !selectedModel) {
      setError(t(uiLanguage, 'aiPanel.errorSelectModel'));
      return;
    }
    await setActive(selectedProvider, selectedModel);
    setOpen(false);
  };

  const close = () => setOpen(false);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={close}
    >
      <div
        className="w-[520px] max-h-[80vh] bg-quebracho-sidebar border border-quebracho-border rounded-md shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-quebracho-border">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-quebracho-accent" />
            <h2 className="text-quebracho-text-strong text-sm font-medium">
              {configuredProviders.length > 0
                ? t(uiLanguage, 'aiPanel.modalManageProviders')
                : t(uiLanguage, 'aiPanel.modalConfigureProvider')}
            </h2>
          </div>
          <button
            onClick={close}
            className="text-quebracho-text hover:text-quebracho-text-strong"
            title={t(uiLanguage, 'settings.close')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto space-y-4 sidebar-scroll">
          {/* Configured providers — switch or delete already-saved keys */}
          {configuredProviders.length > 0 && (
            <div>
              <label className="block text-xs text-quebracho-text-dim mb-2">
                {t(uiLanguage, 'aiPanel.configuredProviders')}
              </label>
              <div className="border border-quebracho-border rounded divide-y divide-quebracho-border/60 overflow-hidden">
                {configuredProviders.map((pid) => {
                  const info = providers.find((p) => p.id === pid);
                  const name = info?.name || pid;
                  const isActive = pid === activeProvider;
                  const isConfirming = confirmDelete === pid;
                  return (
                    <div
                      key={pid}
                      className="flex items-center justify-between px-3 py-2 bg-quebracho-input/30"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Check size={12} className="text-quebracho-accent flex-shrink-0" />
                        <span className="text-[13px] text-quebracho-text-strong truncate">
                          {name}
                        </span>
                        {isActive && (
                          <span className="text-[10px] uppercase tracking-wide text-quebracho-accent border border-quebracho-accent/40 rounded px-1.5 py-0.5 flex-shrink-0">
                            {t(uiLanguage, 'aiPanel.active')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!isActive && (
                          <button
                            onClick={() => setSelectedProvider(pid)}
                            className="text-[11px] text-quebracho-text-dim hover:text-quebracho-accent"
                            title={t(uiLanguage, 'aiPanel.useProviderInForm', { name })}
                          >
                            {t(uiLanguage, 'aiPanel.select')}
                          </button>
                        )}
                        {isConfirming ? (
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] text-red-400">
                              {t(uiLanguage, 'aiPanel.deleteConfirm')}
                            </span>
                            <button
                              onClick={() => handleDeleteProvider(pid)}
                              className="text-[11px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30"
                            >
                              {t(uiLanguage, 'aiPanel.yes')}
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-[11px] px-2 py-0.5 rounded text-quebracho-text-dim hover:text-quebracho-text-strong"
                            >
                              {t(uiLanguage, 'aiPanel.no')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(pid)}
                            title={t(uiLanguage, 'aiPanel.deleteApiKey', { name })}
                            className="h-6 w-6 rounded flex items-center justify-center text-quebracho-text-dim hover:text-red-400 hover:bg-red-500/10"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-quebracho-text-dim leading-relaxed">
                {t(uiLanguage, 'aiPanel.deleteApiKeyHelp')}
              </p>
            </div>
          )}

          {/* Provider grid */}
          <div>
            <label className="block text-xs text-quebracho-text-dim mb-2">
              {configuredProviders.length > 0
                ? t(uiLanguage, 'aiPanel.addOrUpdateKey')
                : t(uiLanguage, 'aiPanel.provider')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {providers.map((p) => {
                const isConfigured = configuredProviders.includes(p.id);
                const isSelected = selectedProvider === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProvider(p.id)}
                    className={`relative text-left px-3 py-2 rounded border transition-colors
                      ${isSelected
                        ? 'border-quebracho-accent bg-quebracho-accent/10 text-quebracho-text-strong'
                        : 'border-quebracho-border bg-quebracho-input/40 text-quebracho-text hover:bg-quebracho-input'}
                    `}
                  >
                    <div className="text-[13px] font-medium flex items-center gap-1.5">
                      {p.name}
                      {isConfigured && (
                        <Check size={12} className="text-quebracho-accent" />
                      )}
                    </div>
                    {p.hint && (
                      <div className="text-[11px] text-quebracho-text-dim mt-0.5">
                        {p.hint}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {selectedProvider && (
              <div className="mt-2 text-[11px] text-quebracho-text-dim">
                {providers.find((p) => p.id === selectedProvider)?.hint}
              </div>
            )}
          </div>

          {/* API key input */}
          <div>
            <label className="block text-xs text-quebracho-text-dim mb-1">
              {t(uiLanguage, 'aiPanel.apiKey')}
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="password"
                placeholder="sk-... / AIza... / etc."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !saving) handleSaveKey();
                }}
                className="quebracho-input flex-1"
              />
              <button
                onClick={handleSaveKey}
                disabled={saving || !selectedProvider || !apiKey.trim()}
                className={`px-3 rounded text-[13px] font-medium transition-colors
                  ${saving || !selectedProvider || !apiKey.trim()
                    ? 'bg-quebracho-input/60 text-quebracho-text-dim cursor-not-allowed'
                    : 'bg-quebracho-accent text-black hover:opacity-90'}
                `}
              >
                {saving ? t(uiLanguage, 'aiPanel.saving') : t(uiLanguage, 'aiPanel.saveAndListModels')}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              {keyringStatus === 'os' && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-0.5">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  {t(uiLanguage, 'aiPanel.keyringStatus.os')}
                </span>
              )}
              {keyringStatus === 'local' && (
                <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-0.5">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  {t(uiLanguage, 'aiPanel.keyringStatus.local')}
                </span>
              )}
            </div>
            <p className="mt-2 text-[11px] text-quebracho-text-dim leading-relaxed">
              {keyringStatus === 'os'
                ? t(uiLanguage, 'aiPanel.keyStored')
                : t(uiLanguage, 'aiPanel.keyStoredLocally')}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 whitespace-pre-wrap">
              {error}
            </div>
          )}

          {/* Model selection */}
          {(loadingModels || models.length > 0) && (
            <div>
              <label className="block text-xs text-quebracho-text-dim mb-1">
                {t(uiLanguage, 'aiPanel.model')}
              </label>
              {loadingModels ? (
                <div className="flex items-center gap-2 text-quebracho-text-dim text-[12px]">
                  <Loader2 size={14} className="animate-spin" />
                  {t(uiLanguage, 'aiPanel.fetchingModels')}
                </div>
              ) : (
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="quebracho-input w-full"
                >
                  {models.map((m) => (
                    <option key={m} value={m} className="bg-quebracho-sidebar">
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-quebracho-border">
          <button
            onClick={close}
            className="px-3 py-1.5 text-[12px] text-quebracho-text hover:text-quebracho-text-strong"
          >
            {t(uiLanguage, 'aiPanel.cancel')}
          </button>
          <button
            onClick={handleActivate}
            disabled={!selectedProvider || !selectedModel}
            className={`px-3 py-1.5 rounded text-[12px] font-medium transition-colors
              ${!selectedProvider || !selectedModel
                ? 'bg-quebracho-input/60 text-quebracho-text-dim cursor-not-allowed'
                : 'bg-quebracho-accent text-black hover:opacity-90'}
            `}
          >
            {t(uiLanguage, 'aiPanel.activate')}
          </button>
        </div>
      </div>
    </div>
  );
}
