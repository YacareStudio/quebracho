# Guia de actualizaciones en Quebracho (Tauri v2)

Esta guia explica como habilitar y operar el flujo de actualizaciones de la app.

## Por que se hace esto

- Permite que usuarios instalados reciban nuevas versiones sin reinstalar manualmente.
- Evita distribucion de binarios sin integridad verificable.
- Mantiene control de versionado y trazabilidad de releases.

## Como funciona

1. La app pregunta por una nueva version en un endpoint remoto.
2. Si hay una version mas nueva, descarga el paquete de update.
3. Verifica firma criptografica (minisign) con la clave publica configurada.
4. Instala el update y solicita reinicio.

Sin firma valida, el update no debe instalarse.

## Estado actual en este repo

- Updater integrado en backend Rust.
- Menu Ayuda con accion Buscar actualizacion.
- Configuracion base lista en src-tauri/tauri.conf.json.
- Workflow de release listo en .github/workflows/release-tauri.yml.
- Plantilla de manifest: docs/updater/latest.template.json.

Nota: en esta base, updater esta en active=false para no romper entornos sin endpoint/pubkey reales.

## Paso 1: Configurar updater en Tauri

Archivo: src-tauri/tauri.conf.json

Debes completar:

- plugins.updater.pubkey
- plugins.updater.endpoints
- plugins.updater.active = true

Ejemplo minimo:

```json
"plugins": {
  "updater": {
    "active": true,
    "dialog": false,
    "pubkey": "TU_CLAVE_PUBLICA_MINISIGN",
    "endpoints": [
      "https://tu-dominio.com/quebracho/latest.json"
    ]
  }
}
```

## Paso 2: Generar claves y firmar artefactos

### 2.1 Generar claves (una sola vez)

```bash
npm run updater:keygen
```

Esto genera clave privada y publica.

- La publica va en tauri.conf.json (pubkey).
- La privada va en CI como secreto.

### 2.2 Configurar secretos en GitHub

En tu repo de GitHub, crea:

- TAURI_SIGNING_PRIVATE_KEY
- TAURI_SIGNING_PRIVATE_KEY_PASSWORD

Estos secretos los usa el workflow para firmar artefactos de release.

## Paso 3: Publicar releases y endpoint de updates

### 3.1 Publicar release automatizado

Workflow: .github/workflows/release-tauri.yml

Opciones:

- Crear tag y push: v1.0.1
- O ejecutar manualmente workflow_dispatch

El workflow:

- Compila en Windows/Linux/macOS
- Firma artefactos
- Crea release draft en GitHub

### 3.2 Crear/actualizar latest.json

Puedes iniciar un template con:

```bash
npm run updater:latest:init
```

Genera docs/updater/latest.json con placeholders.

Luego completa firmas y URLs reales de artefactos publicados.

Referencia inicial: docs/updater/latest.template.json

Finalmente, publica latest.json en el endpoint configurado en tauri.conf.json.

## Flujo recomendado de versionado

1. Subir version en package.json y src-tauri/tauri.conf.json.
2. Commit.
3. Tag: vX.Y.Z.
4. Push del tag.
5. Revisar release draft y artefactos.
6. Completar latest.json con URLs y firmas finales.
7. Publicar latest.json en servidor/CDN.
8. Probar update desde una instalacion de version anterior.

## Checklist de prueba (obligatorio)

- App instalada en version vieja.
- latest.json apunta a version mas nueva.
- Firma coincide con artefacto.
- Ayuda > Buscar actualizacion descarga e instala.
- Reinicio deja app en nueva version.
- Si alteras binario o firma, update debe fallar.

## Errores comunes

- pubkey incorrecta o incompleta.
- latest.json inaccesible o sin HTTPS.
- Firma de artefacto no coincide.
- Mismo numero de version (no hay update).
- Probar en tauri dev en lugar de instalador real.

## Seguridad

- No subas clave privada al repo.
- Usa secrets del CI.
- Rotar clave privada solo con plan de migracion de pubkey.

## Preguntas frecuentes

### Puedo usar GitHub Releases como hosting del update?

Si, pero debes exponer un latest.json estable que apunte a assets publicados.

### Puedo tener canal beta y estable?

Si. Usa endpoints distintos y latest.json distintos (por ejemplo beta/latest.json y stable/latest.json).
