export type Platform = 'windows' | 'macos' | 'linux';

/** Host OS, detected once from the WebView (WebView2, WKWebView or WebKitGTK). */
export const platform: Platform = (() => {
  const raw = (typeof navigator !== 'undefined' ? navigator.platform : '').toLowerCase();
  if (raw.includes('win')) return 'windows';
  if (raw.includes('mac')) return 'macos';
  return 'linux';
})();

/** Monospace stack covering the fonts each OS ships by default. */
export const MONO_FONT_STACK =
  "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, 'SF Mono', Menlo, " +
  "'DejaVu Sans Mono', 'Liberation Mono', 'Ubuntu Mono', 'Noto Sans Mono', 'Courier New', monospace";
