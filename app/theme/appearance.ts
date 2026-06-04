import type { ITheme as XtermTheme } from '@xterm/xterm';

export type ColorThemeId = 'quebracho-dark' | 'aura-dark';
export type FileIconThemeId = 'classic' | 'material';

export const DEFAULT_COLOR_THEME: ColorThemeId = 'quebracho-dark';
export const DEFAULT_FILE_ICON_THEME: FileIconThemeId = 'material';

export const colorThemeOptions: Array<{ value: ColorThemeId; labelKey: string }> = [
  { value: 'quebracho-dark', labelKey: 'settings.themeQuebrachoDark' },
  { value: 'aura-dark', labelKey: 'settings.themeAuraDark' },
];

export const fileIconThemeOptions: Array<{ value: FileIconThemeId; labelKey: string }> = [
  { value: 'material', labelKey: 'settings.iconThemeMaterial' },
  { value: 'classic', labelKey: 'settings.iconThemeClassic' },
];

export function normalizeColorTheme(value: string | null | undefined): ColorThemeId {
  return value === 'aura-dark' ? 'aura-dark' : 'quebracho-dark';
}

export function normalizeFileIconTheme(value: string | null | undefined): FileIconThemeId {
  return value === 'classic' ? 'classic' : 'material';
}

export function getMonacoThemeName(theme: ColorThemeId): string {
  return theme === 'aura-dark' ? 'aura-dark' : 'quebracho-dark';
}

export function applyColorThemeToDocument(theme: ColorThemeId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-color-theme', theme);
}

export function defineMonacoThemes(monaco: typeof import('monaco-editor')): void {
  monaco.editor.defineTheme('quebracho-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'ABB2BF', background: '2D2F38' },
      { token: 'comment', foreground: '5C6370', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'FF6B6B' },
      { token: 'keyword.control', foreground: 'FF6B6B' },
      { token: 'keyword.operator', foreground: 'D0D3DA' },
      { token: 'storage', foreground: 'FF6B6B' },
      { token: 'storage.type', foreground: 'FF6B6B' },
      { token: 'storage.modifier', foreground: 'FF6B6B' },
      { token: 'tag', foreground: 'FF6B6B' },
      { token: 'metatag', foreground: 'FF6B6B' },
      { token: 'attribute.name', foreground: 'E06C75' },
      { token: 'property', foreground: 'E06C75' },
      { token: 'key', foreground: 'E06C75' },
      { token: 'string', foreground: 'E06C75' },
      { token: 'regexp', foreground: 'E06C75' },
      { token: 'delimiter', foreground: 'D0D3DA' },
      { token: 'identifier', foreground: 'ABB2BF' },
      { token: 'variable', foreground: 'ABB2BF' },
      { token: 'function', foreground: '4ADB94' },
      { token: 'method', foreground: '4ADB94' },
      { token: 'number', foreground: 'D19A66' },
      { token: 'constant', foreground: 'D19A66' },
      { token: 'type', foreground: 'E5C07B' },
      { token: 'class', foreground: 'E5C07B' },
      { token: 'operator', foreground: 'D0D3DA' },
      { token: 'invalid', foreground: 'FF5370' },
    ],
    colors: {
      'editor.background': '#2D2F38',
      'editor.foreground': '#ABB2BF',
      'editorCursor.foreground': '#4ADB94',
      'editor.selectionBackground': '#3E4451',
      'editor.inactiveSelectionBackground': '#3E445199',
      'editor.findMatchBackground': '#4ADB9444',
      'editor.findMatchHighlightBackground': '#4ADB9422',
      'editorLineNumber.foreground': '#636D83',
      'editorLineNumber.activeForeground': '#ABB2BF',
      'editorGutter.background': '#2D2F38',
      'editor.lineHighlightBackground': '#FFFFFF08',
      'editorWhitespace.foreground': '#3A3F4B',
      'editorIndentGuide.background': '#3A3F4B',
      'editorIndentGuide.activeBackground': '#4ADB9466',
      'editorBracketMatch.background': '#4ADB9422',
      'editorBracketMatch.border': '#4ADB9488',
      'editorWidget.background': '#24282E',
      'editorWidget.border': '#3A3F4B',
      'editorSuggestWidget.background': '#24282E',
      'editorSuggestWidget.border': '#3A3F4B',
      'editorSuggestWidget.selectedBackground': '#3E4451',
      'editorSuggestWidget.highlightForeground': '#4ADB94',
      'editorHoverWidget.background': '#24282E',
      'editorHoverWidget.border': '#3A3F4B',
      'scrollbarSlider.background': '#FFFFFF14',
      'scrollbarSlider.hoverBackground': '#FFFFFF22',
      'scrollbarSlider.activeBackground': '#FFFFFF33',
      'minimap.background': '#2D2F38',
      'editorOverviewRuler.border': '#2D2F38',
    },
  });

  monaco.editor.defineTheme('aura-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'E7E8FF', background: '15141B' },
      { token: 'comment', foreground: '6D6C88', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'B38CFF' },
      { token: 'keyword.control', foreground: 'B38CFF' },
      { token: 'storage', foreground: 'B38CFF' },
      { token: 'string', foreground: '7EE7FF' },
      { token: 'regexp', foreground: '7EE7FF' },
      { token: 'number', foreground: 'FFB870' },
      { token: 'constant', foreground: 'FFB870' },
      { token: 'function', foreground: '9BFFCC' },
      { token: 'method', foreground: '9BFFCC' },
      { token: 'type', foreground: 'FFCF8B' },
      { token: 'class', foreground: 'FFCF8B' },
      { token: 'variable', foreground: 'E7E8FF' },
      { token: 'identifier', foreground: 'E7E8FF' },
      { token: 'operator', foreground: 'D9DBFF' },
      { token: 'tag', foreground: 'FF87B8' },
      { token: 'attribute.name', foreground: 'C5A7FF' },
      { token: 'attribute.value', foreground: '7EE7FF' },
      { token: 'invalid', foreground: 'FF6B8A' },
    ],
    colors: {
      'editor.background': '#15141B',
      'editor.foreground': '#E7E8FF',
      'editorCursor.foreground': '#8DFFB6',
      'editor.selectionBackground': '#3D2C6A88',
      'editor.inactiveSelectionBackground': '#3D2C6A55',
      'editor.findMatchBackground': '#9E7CFF66',
      'editor.findMatchHighlightBackground': '#9E7CFF33',
      'editorLineNumber.foreground': '#726B9A',
      'editorLineNumber.activeForeground': '#D9DBFF',
      'editorGutter.background': '#15141B',
      'editor.lineHighlightBackground': '#FFFFFF08',
      'editorWhitespace.foreground': '#3A3550',
      'editorIndentGuide.background': '#3A3550',
      'editorIndentGuide.activeBackground': '#9E7CFF99',
      'editorBracketMatch.background': '#9E7CFF33',
      'editorBracketMatch.border': '#9E7CFFAA',
      'editorWidget.background': '#1B1A24',
      'editorWidget.border': '#38324E',
      'editorSuggestWidget.background': '#1B1A24',
      'editorSuggestWidget.border': '#38324E',
      'editorSuggestWidget.selectedBackground': '#2B2640',
      'editorSuggestWidget.highlightForeground': '#9E7CFF',
      'editorHoverWidget.background': '#1B1A24',
      'editorHoverWidget.border': '#38324E',
      'scrollbarSlider.background': '#FFFFFF18',
      'scrollbarSlider.hoverBackground': '#FFFFFF2A',
      'scrollbarSlider.activeBackground': '#FFFFFF36',
      'minimap.background': '#15141B',
      'editorOverviewRuler.border': '#15141B',
    },
  });
}

export function getXtermTheme(theme: ColorThemeId): XtermTheme {
  if (theme === 'aura-dark') {
    return {
      background: '#12111A',
      foreground: '#D7D9FF',
      cursor: '#8DFFB6',
      cursorAccent: '#12111A',
      selectionBackground: '#9E7CFF44',
      black: '#12111A',
      brightBlack: '#5E5783',
      red: '#FF7FA8',
      brightRed: '#FF9BBC',
      green: '#8DFFB6',
      brightGreen: '#A9FFCA',
      yellow: '#FFD08A',
      brightYellow: '#FFE1AF',
      blue: '#8FB4FF',
      brightBlue: '#ABC7FF',
      magenta: '#B38CFF',
      brightMagenta: '#CEB1FF',
      cyan: '#7EE7FF',
      brightCyan: '#A0EEFF',
      white: '#D7D9FF',
      brightWhite: '#FFFFFF',
    };
  }

  return {
    background: '#1F2025',
    foreground: '#B1B4BC',
    cursor: '#4ADB94',
    cursorAccent: '#1F2025',
    selectionBackground: '#4ADB9444',
    black: '#1F2025',
    brightBlack: '#5A5F6E',
    red: '#FF5370',
    brightRed: '#FF8B98',
    green: '#4ADB94',
    brightGreen: '#7AE5B4',
    yellow: '#FFCB6B',
    brightYellow: '#FFE082',
    blue: '#82AAFF',
    brightBlue: '#A8C5FF',
    magenta: '#C792EA',
    brightMagenta: '#DDB3F2',
    cyan: '#89DDFF',
    brightCyan: '#A8E5FF',
    white: '#D0D3DA',
    brightWhite: '#FFFFFF',
  };
}
