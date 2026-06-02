# AGENTS.md — Quebracho

## Propósito
Este archivo documenta los agentes, subagentes y roles automatizados que participan en el ciclo de desarrollo y operación de Quebracho.

## Resumen Operativo (rápido)
- `AIPanel`: coordinación de interacción con modelos y ejecución de tareas asistidas.
- `Release Tauri`: build y publicación multi-plataforma vía GitHub Actions.
- `Updater Tauri`: actualizaciones firmadas (minisign) mediante `latest.json`.
- `Theme Engine`: motor de tema visual (editor/UI/terminal) con presets y persistencia.
- `Icon Theme Engine`: resolución de íconos por archivo/carpeta en explorador (estilo Material-like).
- `Account`: placeholder con aviso explícito de funcionalidad no disponible.
- Para releases: mantener consistentes `tag`, `version` y assets firmados.

---

## Agentes principales

### 1. Orquestador SDD (Spec-Driven Development)
- **Rol:** Coordina el ciclo completo de cambios estructurados (exploración, propuesta, especificación, diseño, tareas, implementación, verificación, archivado).
- **Subagentes:**
  - `sdd-explore`: Exploración y análisis de ideas/código.
  - `sdd-propose`: Redacción de propuestas de cambio.
  - `sdd-spec`: Especificación de requisitos y escenarios.
  - `sdd-design`: Diseño técnico y decisiones arquitectónicas.
  - `sdd-tasks`: Desglose en tareas accionables.
  - `sdd-apply`: Implementación automatizada.
  - `sdd-verify`: Validación contra especificación.
  - `sdd-archive`: Cierre y persistencia de cambios.

### 2. Engram (Memoria Persistente)
- **Rol:** Guarda decisiones, bugs, convenciones y hallazgos técnicos a lo largo del tiempo.
- **Uso:** Proactivo tras cada decisión, fix, convención o descubrimiento relevante.

### 3. Judgment Day (Revisión Adversarial)
- **Rol:** Revisión dual de cambios críticos, con jueces independientes (A/B) y agente de fixes quirúrgicos.
- **Subagentes:**
  - `jd-judge-a` y `jd-judge-b`: Revisión ciega y adversarial.
  - `jd-fix-agent`: Aplica fixes confirmados por consenso.

---

## Agentes de UI y flujo

- **AIPanel:** Orquesta la interacción con modelos de IA y agentes de código.
- **SettingsModal:** Permite al usuario seleccionar idioma y preferencias.
- **Theme Engine:** Orquesta la aplicación de paletas visuales (variables CSS + Monaco + terminal) según preferencia de usuario.
- **Icon Theme Engine:** Resuelve íconos de archivo/carpeta por extensión/nombre para el árbol del explorador.
- **LiveServer:** Agente para servir y refrescar proyectos web en tiempo real.
- **Account (placeholder):** Actualmente muestra aviso informativo de funcionalidad no disponible para evitar acciones sin feedback.

---

## Agentes de release y actualización

- **Release Tauri (GitHub Actions):** Pipeline multi-plataforma (`windows`, `ubuntu`, `macos`) para compilar, firmar y publicar assets de release.
- **Updater Tauri:** Canal de actualización de app con `latest.json`, firma minisign y endpoint de GitHub Releases.
- **Regla de publicación:** Los releases se publican visibles (no draft) y se marcan como prerelease cuando el tag contiene sufijo (ej. `-alpha`, `-beta`).
- **Bundling por plataforma:**
  - Windows: `nsis` (se evita `msi` para prerelease alfanumérico).
  - Linux: `appimage,deb,rpm`.
  - macOS: `dmg`.

---

## Convenciones
- Todos los agentes respetan el idioma de UI seleccionado.
- El orquestador SDD siempre delega tareas complejas a subagentes especializados.
- Engram se usa para memoria de decisiones y descubrimientos, nunca para datos sensibles.
- El flujo de release depende de secrets de firma (`TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) y de mantener el `latest.json` consistente con los assets publicados.
- La estrategia de temas/extensiones visuales prioriza compatibilidad parcial declarativa (JSON/SVG), sin ejecutar código JS de terceros.

---

## Última actualización
01/06/2026
