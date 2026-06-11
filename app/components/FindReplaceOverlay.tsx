import { useState, useEffect, useRef, useCallback } from 'react';
import type { editor } from 'monaco-editor';
import {
  X,
  ChevronDown,
  ChevronUp,
  Replace,
  CaseSensitive,
  WholeWord,
  Regex,
} from 'lucide-react';
import { useStore } from '../store';
import { t } from '../i18n';

interface Props {
  editor: editor.IStandaloneCodeEditor | null;
}

type FindMode = 'find' | 'replace';

/** Decoration style for the active match (outline + background). */
const ACTIVE_MATCH_DECORATION = {
  inlineClassName: 'qb-find-active-match',
  overviewRuler: { color: '#4ADB94', position: 4 },
  minimap: { color: '#4ADB94', position: 2 },
  zIndex: 10,
};

/** Decoration style for other matches (subtle background). */
const MATCH_DECORATION = {
  inlineClassName: 'qb-find-match',
  overviewRuler: { color: '#4ADB9480', position: 4 },
  zIndex: 5,
};

export default function FindReplaceOverlay({ editor }: Props) {
  const uiLanguage = useStore((s) => s.uiLanguage);

  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<FindMode>('find');
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);

  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const prevQueryRef = useRef('');

  /** Compute matches for the current query and options. */
  const computeMatches = useCallback((): editor.FindMatch[] => {
    if (!editor || !query) return [];
    const model = editor.getModel();
    if (!model) return [];
    return model.findMatches(
      query,
      false, // searchOnlyEditableRange
      useRegex,
      matchCase,
      wholeWord ? ' ' : null, // wordSeparators
      true, // captureMatches
      9999 // limit
    );
  }, [editor, query, matchCase, wholeWord, useRegex]);

  /** Apply decorations: one active, rest subtle. */
  const applyDecorations = useCallback(
    (matches: editor.FindMatch[], activeIdx: number) => {
      if (!editor) return;
      const newDecorations: editor.IModelDeltaDecoration[] = [];
      matches.forEach((m, idx) => {
        newDecorations.push({
          range: m.range,
          options: idx === activeIdx ? ACTIVE_MATCH_DECORATION : MATCH_DECORATION,
        });
      });
      decorationIdsRef.current = editor.deltaDecorations(
        decorationIdsRef.current,
        newDecorations
      );
    },
    [editor]
  );

  /** Clear all find decorations. */
  const clearDecorations = useCallback(() => {
    if (!editor) return;
    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
  }, [editor]);

  /** Update match count + decorations without changing cursor. */
  const refreshMatches = useCallback(() => {
    const matches = computeMatches();
    setTotalMatches(matches.length);
    if (matches.length === 0) {
      setCurrentIndex(0);
      clearDecorations();
      return;
    }
    setCurrentIndex(1);
    applyDecorations(matches, 0);
  }, [computeMatches, clearDecorations, applyDecorations]);

  /** Jump to a specific match by index. */
  const jumpToMatch = useCallback(
    (matches: editor.FindMatch[], idx: number) => {
      if (!editor || matches.length === 0) return;
      const clamped = ((idx % matches.length) + matches.length) % matches.length;
      const match = matches[clamped];
      editor.setSelection(match.range);
      editor.revealRangeInCenterIfOutsideViewport(match.range);
      setCurrentIndex(clamped + 1);
      applyDecorations(matches, clamped);
    },
    [editor, applyDecorations]
  );

  const navigate = useCallback(
    (direction: 'next' | 'prev') => {
      if (!editor || !query) return;
      const matches = computeMatches();
      if (matches.length === 0) return;

      const selection = editor.getSelection();
      let idx = 0;
      if (selection) {
        const cursorPos = selection.getStartPosition();
        if (direction === 'next') {
          idx = matches.findIndex((m) => cursorPos.isBefore(m.range.getStartPosition()));
          if (idx === -1) idx = 0;
        } else {
          idx = -1;
          for (let i = matches.length - 1; i >= 0; i--) {
            if (matches[i].range.getEndPosition().isBefore(cursorPos)) {
              idx = i;
              break;
            }
          }
          if (idx === -1) idx = matches.length - 1;
        }
      }
      jumpToMatch(matches, idx);
    },
    [editor, query, computeMatches, jumpToMatch]
  );

  const handleReplace = useCallback(() => {
    if (!editor || !query) return;
    const selection = editor.getSelection();
    if (!selection) return;
    const model = editor.getModel();
    if (!model) return;

    const selectedText = model.getValueInRange(selection);
    const searchRegex = useRegex
      ? new RegExp(query, matchCase ? '' : 'i')
      : new RegExp(
          query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          matchCase ? '' : 'i'
        );

    if (!searchRegex.test(selectedText)) {
      navigate('next');
      return;
    }

    editor.pushUndoStop();
    editor.executeEdits('find-replace', [
      {
        range: selection,
        text: replacement,
      },
    ]);
    editor.pushUndoStop();
    navigate('next');
  }, [editor, query, replacement, matchCase, useRegex, navigate]);

  const handleReplaceAll = useCallback(() => {
    if (!editor || !query) return;
    const model = editor.getModel();
    if (!model) return;

    const matches = computeMatches();
    if (matches.length === 0) return;

    // Apply edits from bottom to top so ranges don't shift
    const edits = matches
      .slice()
      .reverse()
      .map((m) => ({
        range: m.range,
        text: replacement,
      }));

    editor.pushUndoStop();
    editor.executeEdits('find-replace-all', edits);
    editor.pushUndoStop();
    setTotalMatches(0);
    setCurrentIndex(0);
    clearDecorations();
  }, [editor, query, replacement, computeMatches, clearDecorations]);

  // Open/close via custom events from App.tsx or Monaco keybindings
  useEffect(() => {
    const onOpenFind = () => {
      setMode('find');
      setVisible(true);
    };
    const onOpenReplace = () => {
      setMode('replace');
      setVisible(true);
    };
    window.addEventListener('quebracho:open-find', onOpenFind);
    window.addEventListener('quebracho:open-replace', onOpenReplace);
    return () => {
      window.removeEventListener('quebracho:open-find', onOpenFind);
      window.removeEventListener('quebracho:open-replace', onOpenReplace);
    };
  }, []);

  // Global find-next / find-prev while overlay is visible
  useEffect(() => {
    if (!visible) return;
    const onFindNext = () => navigate('next');
    const onFindPrev = () => navigate('prev');
    window.addEventListener('quebracho:find-next', onFindNext);
    window.addEventListener('quebracho:find-prev', onFindPrev);
    return () => {
      window.removeEventListener('quebracho:find-next', onFindNext);
      window.removeEventListener('quebracho:find-prev', onFindPrev);
    };
  }, [visible, navigate]);

  // Focus input when visible; also seed query from current selection
  useEffect(() => {
    if (!visible || !editor) return;
    requestAnimationFrame(() => {
      // If user has text selected, use it as the initial query.
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (selection && model && !selection.isEmpty()) {
        const selected = model.getValueInRange(selection);
        if (selected && selected.length < 200 && !selected.includes('\n')) {
          setQuery(selected);
          // Decorations will refresh via the query effect below
        }
      }
      if (mode === 'replace' && replaceInputRef.current) {
        replaceInputRef.current.focus();
      } else {
        findInputRef.current?.focus();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode, editor]);

  // Refresh decorations whenever query or options change
  useEffect(() => {
    if (!visible || !editor) return;
    if (!query) {
      setTotalMatches(0);
      setCurrentIndex(0);
      clearDecorations();
      return;
    }
    // Debounce slightly so typing fast doesn't thrash
    const timer = setTimeout(() => {
      refreshMatches();
    }, 50);
    return () => clearTimeout(timer);
  }, [query, matchCase, wholeWord, useRegex, visible, editor, refreshMatches, clearDecorations]);

  // Close on Escape and handle F3 navigation while the overlay is visible.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setVisible(false);
        clearDecorations();
        editor?.focus();
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) {
          navigate('prev');
        } else {
          navigate('next');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, editor, clearDecorations, navigate]);

  // Close overlay when Monaco switches models (tab change)
  useEffect(() => {
    if (!editor || !visible) return;
    const disposable = editor.onDidChangeModel(() => {
      setVisible(false);
      clearDecorations();
    });
    return () => disposable.dispose();
  }, [editor, visible, clearDecorations]);

  // Clean up decorations on unmount
  useEffect(() => {
    return () => {
      clearDecorations();
    };
  }, [clearDecorations]);

  if (!visible || !editor) return null;

  return (
    <div className="absolute top-2 right-2 z-50 w-80 bg-quebracho-sidebar border border-quebracho-border rounded shadow-xl flex flex-col">
      {/* Header row */}
      <div className="flex items-center gap-1.5 pl-2 pr-2 pt-1.5 pb-1.5 border-b border-quebracho-border/40">
        <span className="text-[11px] font-medium text-quebracho-text-strong flex-1">
          {mode === 'find'
            ? t(uiLanguage, 'findReplace.find')
            : t(uiLanguage, 'findReplace.findAndReplace')}
        </span>
        <button
          onClick={() => setMode(mode === 'find' ? 'replace' : 'find')}
          title={t(uiLanguage, 'findReplace.toggleMode')}
          className="p-0.5 rounded text-quebracho-text-dim hover:text-quebracho-text hover:bg-quebracho-hover transition-colors"
        >
          <Replace size={12} />
        </button>
        <button
          onClick={() => {
            setVisible(false);
            clearDecorations();
            editor.focus();
          }}
          className="p-0.5 rounded text-quebracho-text-dim hover:text-quebracho-text hover:bg-quebracho-hover transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {/* Find input */}
      <div className="flex items-center gap-1.5 pl-2 pr-2 pt-1.5 pb-1">
        <input
          ref={findInputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              navigate('next');
            }
          }}
          placeholder={t(uiLanguage, 'findReplace.findPlaceholder')}
          className="quebracho-input flex-1 text-[12px]"
        />
        <span className="text-[10px] text-quebracho-text-dim min-w-[3ch] text-right">
          {totalMatches > 0 ? `${currentIndex}/${totalMatches}` : query ? '0/0' : ''}
        </span>
      </div>

      {/* Replace input */}
      {mode === 'replace' && (
        <div className="flex items-center gap-1.5 pl-2 pr-2 pt-0 pb-1">
          <input
            ref={replaceInputRef}
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleReplace();
              }
            }}
            placeholder={t(uiLanguage, 'findReplace.replacePlaceholder')}
            className="quebracho-input flex-1 text-[12px]"
          />
        </div>
      )}

      {/* Options + actions */}
      <div className="flex items-center gap-1 pl-2 pr-2 pt-0 pb-1.5">
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

        <div className="flex-1" />

        <button
          onClick={() => navigate('prev')}
          title={t(uiLanguage, 'findReplace.previous')}
          className="p-0.5 rounded text-quebracho-text-dim hover:text-quebracho-text hover:bg-quebracho-hover transition-colors"
        >
          <ChevronUp size={12} />
        </button>
        <button
          onClick={() => navigate('next')}
          title={t(uiLanguage, 'findReplace.next')}
          className="p-0.5 rounded text-quebracho-text-dim hover:text-quebracho-text hover:bg-quebracho-hover transition-colors"
        >
          <ChevronDown size={12} />
        </button>

        {mode === 'replace' && (
          <>
            <button
              onClick={handleReplace}
              className="pl-2 pr-2 pt-0.5 pb-0.5 rounded text-[11px] bg-quebracho-input hover:bg-quebracho-hover text-quebracho-text transition-colors"
            >
              {t(uiLanguage, 'findReplace.replace')}
            </button>
            <button
              onClick={handleReplaceAll}
              className="pl-2 pr-2 pt-0.5 pb-0.5 rounded text-[11px] bg-quebracho-input hover:bg-quebracho-hover text-quebracho-text transition-colors"
            >
              {t(uiLanguage, 'findReplace.replaceAll')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
