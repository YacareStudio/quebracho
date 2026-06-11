import { confirm as tauriConfirm } from '@tauri-apps/plugin-dialog';

/**
 * Native OS confirmation dialog with a browser fallback.
 *
 * Returns `true` only when the user explicitly accepts. Use before any
 * destructive or irreversible action (deleting a connection, a file, etc.) so
 * confirmation is consistent across the app.
 */
export async function confirmAction(message: string): Promise<boolean> {
  try {
    return await tauriConfirm(message, { title: 'Quebracho', kind: 'warning' });
  } catch {
    return window.confirm(message);
  }
}
