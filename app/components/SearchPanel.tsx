import { useState, useCallback, useRef } from 'react';
import {
  Search,
  Replace,
  CaseSensitive,
  WholeWord,
  Regex,
  ChevronRight,
  FileText,
  Loader2,
  X,
} from 'lucide-react';
import { useStore } from '../store';
import { t } from '../i18n';

interface SearchMatch {
  path: string;
  line: number;
  preview: string;
}

interface SearchResult {
  query: string;
  matches: SearchMatch[];
  truncated: boolean;
}

export default function SearchPanel() {
  const uiLanguage = useStore((s) => s.uiLanguage);
  const workspacePath = useStore((s) => s.workspacePath);
  const openFilePath = useStore((s) => s.openFilePath);

  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replaceAllConfirm, setReplaceAllConfirm] = useState(false);

  const queryInputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(async () => {
    if (!workspacePath || !query.trim()) return;
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const res = await window.forgeAPI.search.workspaceSearch(
        workspacePath,
        query,
        matchCase,
        wholeWord,
        useRegex
      );
      setResults(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setSearching(false);
    }
  }, [workspacePath, query, matchCase, wholeWord, useRegex]);

  const handleReplaceAll = useCallback(async () => {
    if (!workspacePath || !query.trim()) return;
    if (!replaceAllConfirm) {
      setReplaceAllConfirm(true);
      return;
    }
    setReplacing(true);
    setError(null);
    try {
      const res = await window.forgeAPI.search.workspaceReplace(
        workspacePath,
        query,
        replacement,
        matchCase,
        wholeWord,
        useRegex
      );
      setReplaceAllConfirm(false);
      // Refresh search to show updated state
      await handleSearch();
      // Show summary
      setError(
        `${t(uiLanguage, 'searchPanel.replacedInFiles', {
          count: res.replacementsCount,
          files: res.filesModified,
        })}`
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setReplacing(false);
    }
  }, [workspacePath, query, replacement, matchCase, wholeWord, useRegex, replaceAllConfirm, handleSearch, uiLanguage]);

  const handleReplaceInFile = useCallback(
    async (filePath: string) => {
      if (!workspacePath || !query.trim()) return;
      setReplacing(true);
      setError(null);
      try {
        const res = await window.forgeAPI.search.workspaceReplace(
          workspacePath,
          query,
          replacement,
          matchCase,
          wholeWord,
          useRegex,
          filePath
        );
        await handleSearch();
        setError(
          `${t(uiLanguage, 'searchPanel.replacedInFiles', {
            count: res.replacementsCount,
            files: res.filesModified,
          })}`
        );
      } catch (e) {
        setError(String(e));
      } finally {
        setReplacing(false);
      }
    },
    [workspacePath, query, replacement, matchCase, wholeWord, useRegex, handleSearch, uiLanguage]
  );

  const getRelativePath = useCallback((absolutePath: string) => {
    if (!workspacePath) return absolutePath;
    const rel = absolutePath.replace(/\\/g, '/').replace(workspacePath.replace(/\\/g, '/') + '/', '');
    return rel;
  }, [workspacePath]);

  const handleOpenResult = useCallback(
    (match: SearchMatch) => {
      if (!workspacePath) return;
      void openFilePath(match.path);
    },
    [workspacePath, openFilePath]
  );

  // Group matches by file
  const grouped = results
    ? results.matches.reduce<Record<string, SearchMatch[]>>((acc, m) => {
        acc[m.path] = acc[m.path] || [];
        acc[m.path].push(m);
        return acc;
      }, {})
    : {};

  if (!workspacePath) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-quebracho-text/50 text-sm pl-4 pr-4">
        <Search size={28} />
        <p>{t(uiLanguage, 'searchPanel.openProjectFirst')}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Search inputs */}
      <div className="flex flex-col gap-1.5 pl-3 pr-3 pt-2.5 pb-2.5 border-b border-quebracho-border/40 shrink-0">
        <div className="flex items-center gap-1.5">
          <input
            ref={queryInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSearch();
            }}
            placeholder={t(uiLanguage, 'searchPanel.findPlaceholder')}
            className="quebracho-input flex-1 text-[12px]"
          />
          <button
            onClick={() => void handleSearch()}
            disabled={searching || !query.trim()}
            className="p-1 rounded bg-quebracho-accent/20 text-quebracho-accent hover:bg-quebracho-accent/30 transition-colors disabled:opacity-40"
            title={t(uiLanguage, 'searchPanel.search')}
          >
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleReplaceAll();
            }}
            placeholder={t(uiLanguage, 'searchPanel.replacePlaceholder')}
            className="quebracho-input flex-1 text-[12px]"
          />
          <button
            onClick={() => void handleReplaceAll()}
            disabled={replacing || !query.trim()}
            className={`p-1 rounded transition-colors disabled:opacity-40 ${
              replaceAllConfirm
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'bg-quebracho-input text-quebracho-text hover:bg-quebracho-hover'
            }`}
            title={
              replaceAllConfirm
                ? t(uiLanguage, 'searchPanel.confirmReplaceAll')
                : t(uiLanguage, 'searchPanel.replaceAll')
            }
          >
            {replacing ? <Loader2 size={14} className="animate-spin" /> : <Replace size={14} />}
          </button>
          {replaceAllConfirm && (
            <button
              onClick={() => setReplaceAllConfirm(false)}
              className="p-1 rounded text-quebracho-text-dim hover:text-quebracho-text hover:bg-quebracho-hover transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Options */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMatchCase(!matchCase)}
            title={t(uiLanguage, 'findReplace.matchCase')}
            className={`p-0.5 rounded transition-colors ${
              matchCase
                ? 'bg-quebracho-accent/20 text-quebracho-accent'
                : 'text-quebracho-text-dim hover:text-quebracho-text hover:bg-quebracho-hover'
            }`}
          >
            <CaseSensitive size={12} />
          </button>
          <button
            onClick={() => setWholeWord(!wholeWord)}
            title={t(uiLanguage, 'findReplace.wholeWord')}
            className={`p-0.5 rounded transition-colors ${
              wholeWord
                ? 'bg-quebracho-accent/20 text-quebracho-accent'
                : 'text-quebracho-text-dim hover:text-quebracho-text hover:bg-quebracho-hover'
            }`}
          >
            <WholeWord size={12} />
          </button>
          <button
            onClick={() => setUseRegex(!useRegex)}
            title={t(uiLanguage, 'findReplace.useRegex')}
            className={`p-0.5 rounded transition-colors ${
              useRegex
                ? 'bg-quebracho-accent/20 text-quebracho-accent'
                : 'text-quebracho-text-dim hover:text-quebracho-text hover:bg-quebracho-hover'
            }`}
          >
            <Regex size={12} />
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto sidebar-scroll">
        {error && (
          <div className="pl-3 pr-3 pt-2 pb-2 text-[11px] text-quebracho-text-dim">{error}</div>
        )}

        {results && results.matches.length === 0 && (
          <div className="pl-3 pr-3 pt-4 pb-4 text-[12px] text-quebracho-text-dim text-center">
            {t(uiLanguage, 'searchPanel.noResults')}
          </div>
        )}

        {results && results.matches.length > 0 && (
          <div className="flex flex-col">
            <div className="pl-3 pr-3 pt-1.5 pb-1.5 text-[10px] text-quebracho-text-dim border-b border-quebracho-border/30">
              {results.truncated
                ? t(uiLanguage, 'searchPanel.resultsTruncated', { count: results.matches.length })
                : t(uiLanguage, 'searchPanel.resultsCount', { count: results.matches.length })}
            </div>
            {Object.entries(grouped).map(([filePath, matches]) => (
              <div key={filePath} className="flex flex-col border-b border-quebracho-border/20">
                <div className="flex items-center gap-1.5 pl-2 pr-2 pt-1 pb-1 bg-quebracho-editor/30">
                  <FileText size={12} className="text-quebracho-text-dim shrink-0" />
                  <span className="text-[11px] text-quebracho-text-strong truncate flex-1">
                    {getRelativePath(filePath)}
                  </span>
                  <button
                    onClick={() => void handleReplaceInFile(filePath)}
                    disabled={replacing}
                    className="p-0.5 rounded text-quebracho-text-dim hover:text-quebracho-accent hover:bg-quebracho-hover transition-colors disabled:opacity-40 shrink-0"
                    title={t(uiLanguage, 'searchPanel.replaceInFile')}
                  >
                    <Replace size={10} />
                  </button>
                </div>
                {matches.map((m, idx) => (
                  <button
                    key={`${m.path}:${m.line}:${idx}`}
                    onClick={() => handleOpenResult(m)}
                    className="flex items-start gap-1.5 pl-5 pr-2 pt-0.5 pb-0.5 text-left hover:bg-white/[0.03] transition-colors"
                  >
                    <ChevronRight size={10} className="text-quebracho-text-dim shrink-0 mt-0.5" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] text-quebracho-text-dim">
                        Ln {m.line}
                      </span>
                      <span className="text-[11px] text-quebracho-text truncate">
                        {m.preview}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
