import { loader } from '@monaco-editor/react';

/**
 * `@monaco-editor/react` resolves Monaco at runtime from jsDelivr and hardcodes
 * its own default version, which drifts from the `monaco-editor` package we
 * type-check against. Pinning the path here keeps the runtime editor and the
 * `monaco-editor` typings on the same release.
 *
 * Keep MONACO_VERSION in sync with `monaco-editor` in package.json.
 *
 * NOTE: this still fetches Monaco from the network, which the packaged app's
 * CSP (`script-src 'self'`) blocks. See PROPUESTAS-MEJORAS-2026-08-31.md §1 for
 * the local-bundling fix.
 */
const MONACO_VERSION = '0.56.0';

loader.config({
  paths: { vs: `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs` },
});
