# CHANGELOG.md — Quebracho

## [0.0.1] — 2026-06-01
### Added
- Rebranding completo: Quebracho (producto) y Yacare Studio (institucional).
- Internacionalización (i18n) con español e inglés, selector de idioma en configuración, detección automática.
- Panel de configuración con selección de idioma persistente.
- Estructura de agentes SDD (Spec-Driven Development) y Engram (memoria persistente).
- .gitignore adaptado a stack Tauri + React/Vite + Rust.
- Documentación inicial de agentes (AGENTS.md).
- Menú superior completo con subitems en Archivo, Editar, Ver y Ayuda.
- Transformaciones de texto seleccionado (mayúsculas, minúsculas, snake_case, camelCase, kebab-case y PascalCase).
- Acción de Ayuda para buscar actualización de la app (flujo updater en Tauri).
- Documentación de updater y plantillas (`docs/updater/README.md`, `latest.template.json`).
- Workflow de release multi-plataforma en GitHub Actions (`release-tauri.yml`).
- Motor de temas visuales con presets `Forge Dark` y `Aura Dark` (inspirado en Aura Theme), aplicado a Monaco, UI y terminal integrada.
- Motor de íconos de explorador con tema `Material-like` (inspirado en Material Icon Theme) y tema `Classic`.
- Nuevas opciones en Configuración para seleccionar tema de color y tema de íconos, con persistencia en configuración local.
- Nuevos módulos de base para futura compatibilidad parcial con temas/íconos tipo VS Code (`app/theme/appearance.ts`, `app/theme/fileIcons.tsx`).

### Changed
- Compatibilidad de configuración con versiones previas (soporte forge-config.json legacy).
- Configuración de updater y estrategia de publicación de releases visibles (no draft).
- Bundling por plataforma para releases alpha (`nsis` en Windows; `appimage,deb,rpm` en Linux; `dmg` en macOS).
- Versionado alineado al primer lanzamiento `0.0.1`.
- Paleta Forge migrada a variables CSS para permitir theming runtime sin recompilar clases Tailwind.

### Fixed
- Nombrado de asset de logo y paths legacy.
- El botón de Cuenta ya no queda sin feedback: ahora muestra aviso de función no disponible.
- Se bloquea el menú contextual nativo del WebView al hacer clic derecho, manteniendo la UX interna.
- Correcciones de CI release: script `tauri` faltante, formato de `pubkey` updater y fallos de bundle en Windows MSI para prerelease.
