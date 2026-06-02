# Quebracho

Editor de código de escritorio con enfoque agentic, construido con React + Vite en frontend y Tauri + Rust en backend.

Proyecto de Yacare Studio (Chaco, Argentina).

## Tabla de contenidos

- [Qué incluye](#qué-incluye)
- [Stack tecnológico](#stack-tecnológico)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Desarrollo](#desarrollo)
- [Build de producción](#build-de-producción)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Configuración y datos locales](#configuración-y-datos-locales)
- [Actualizaciones automáticas (updater)](#actualizaciones-automáticas-updater)
- [Troubleshooting](#troubleshooting)
- [Licencia](#licencia)

## Qué incluye

- Interfaz de editor estilo IDE con:
  - Barra lateral de archivos.
  - Área de edición.
  - Panel inferior (terminal/salidas).
  - Panel de IA integrado.
- Integración de IA con múltiples proveedores configurables.
- Internacionalización (es/en) con selección de idioma persistente.
- Live Server embebido para servir archivos estáticos desde el workspace.
- Integración Tauri para capacidades nativas (filesystem, procesos, etc.).

## Stack tecnológico

- Frontend:
  - React 18
  - TypeScript
  - Vite 5
  - Zustand
  - Monaco Editor
  - xterm.js
  - Tailwind CSS
- Desktop runtime:
  - Tauri 2
  - Rust 2021

## Requisitos

### Generales

- Node.js 20+ (recomendado LTS actual).
- npm 10+.
- Rust estable (con toolchain nativa según el sistema operativo).
- Tauri CLI (en este repo ya está en devDependencies y se ejecuta vía npm scripts).

### Windows

1. Instalar Node.js LTS:

```powershell
winget install OpenJS.NodeJS.LTS
```

2. Instalar Visual Studio Build Tools (C++):

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools
```

Durante la instalación, habilitar el workload "Desktop development with C++".

3. Instalar Rust (MSVC):

```powershell
winget install Rustlang.Rustup
rustup default stable-x86_64-pc-windows-msvc
rustc --version
cargo --version
```

4. Cerrar y abrir terminal para refrescar PATH.

5. Verificar que el linker de MSVC sea el que se está usando:

```powershell
where link
```

Si aparece primero un `link.exe` de GNU/Git (por ejemplo `D:\laragon\bin\git\usr\bin\link.exe`), mover ese path detrás del toolchain MSVC en PATH para evitar errores de build en Tauri/Rust.

### Linux

#### Ubuntu / Debian

1. Instalar dependencias del sistema para Tauri:

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  curl \
  file \
  pkg-config \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf \
  libwebkit2gtk-4.1-dev
```

Nota: en distros más antiguas puede ser `libwebkit2gtk-4.0-dev`.

2. Instalar Node.js 20 LTS (NodeSource):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

3. Instalar Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup default stable
rustc --version
cargo --version
```

#### Fedora

```bash
sudo dnf install -y \
  gcc-c++ \
  make \
  curl \
  pkgconf-pkg-config \
  openssl-devel \
  gtk3-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  webkit2gtk4.1-devel
```

Después instalar Node.js 20 y Rust (rustup) como en la sección anterior.

### macOS

1. Instalar Xcode Command Line Tools:

```bash
xcode-select --install
```

2. Instalar Homebrew (si no lo tenés):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

3. Instalar Node.js:

```bash
brew install node@20
```

4. Instalar Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup default stable
rustc --version
cargo --version
```

5. Verificar toolchain:

```bash
clang --version
node --version
npm --version
```

## Instalación

Desde la raíz del proyecto:

```bash
npm install
```

## Desarrollo

### App de escritorio (Tauri + frontend)

```bash
npm run dev
```

Esto inicia Tauri en modo desarrollo y levanta Vite automáticamente usando la configuración de `src-tauri/tauri.conf.json`.

### Solo frontend web (sin shell nativa)

```bash
npm run dev:web
```

Servidor Vite en:

- http://localhost:5173

## Build de producción

### Build desktop (instalables/bundles de Tauri)

```bash
npm run build
```

## Actualizaciones automáticas (updater)

Guía completa (configuración, firma, release y pruebas):

- [docs/updater/README.md](docs/updater/README.md)

Comandos útiles:

```bash
npm run updater:keygen
npm run updater:latest:init
```

### Build web estático

```bash
npm run build:web
```

Salida en `dist/`.

## Estructura del proyecto

```text
.
├─ app/                # Frontend React/TypeScript
│  ├─ components/      # UI principal y paneles
│  ├─ ai/              # Runtime/protocolo de IA en frontend
│  ├─ i18n/            # Internacionalización
│  └─ lsp/             # Cliente LSP
├─ src-tauri/          # Backend Rust + configuración Tauri
│  ├─ src/main.rs      # Comandos nativos, terminal, live server, IA
│  └─ tauri.conf.json  # Config de ventana/build/bundle
├─ index.html
├─ package.json
└─ vite.config.ts
```

## Configuración y datos locales

Quebracho guarda configuración de app en el directorio de configuración del sistema operativo usando Tauri.

Archivo principal:

- `quebracho-config.json`

Incluye, entre otros:

- Último workspace abierto.
- Idioma de UI.
- Proveedor y modelo de IA activos.
- Claves de proveedores de IA.

Nota: también existe compatibilidad de lectura para configuración legacy (`forge-config.json`).

## Troubleshooting

### Error de linker en Windows al compilar

Síntomas frecuentes:

- Errores con `link: extra operand ...`
- O `link.exe not found`

Qué revisar:

1. Que Visual Studio Build Tools esté instalado con C++ Desktop.
2. Que el `link.exe` correcto (MSVC) esté disponible.
3. Que no esté primero en PATH un `link.exe` de GNU/Git que cause shadowing.

### El frontend no arranca en `npm run dev`

- Ejecutar primero `npm install`.
- Verificar que el puerto 5173 esté libre.
- Revisar conflictos de firewall o antivirus con procesos de Vite/Tauri.

### Cambios en Rust no se reflejan

- Reiniciar `npm run dev` tras cambios estructurales en `src-tauri/src/main.rs` o en `tauri.conf.json`.

## Licencia

Este proyecto está distribuido bajo AGPL-3.0. Revisar el archivo `LICENSE` para el texto completo.
