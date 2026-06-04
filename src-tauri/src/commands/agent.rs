use crate::models::{
    AgentInitManifestFile, AgentInitResult, AgentListEntry, AgentListResult, AgentReadResult,
    AgentSearchMatch, AgentSearchResult, AgentSnapshotFile, AgentWriteResult,
};
use crate::utils::{normalize_path, read_text_file_safe, resolve_within_workspace};
use std::fs;
use std::path::PathBuf;
use walkdir::WalkDir;

const MAX_SNAPSHOT_FILES: usize = 120;
const MAX_SEARCH_RESULTS: usize = 200;

#[tauri::command]
pub fn agent_leer_archivo(workspace_path: String, ruta: String) -> Result<AgentReadResult, String> {
    let full = resolve_within_workspace(&workspace_path, &ruta)?;
    let content = fs::read_to_string(&full).map_err(|e| format!("read file failed: {e}"))?;
    Ok(AgentReadResult {
        path: normalize_path(&full),
        bytes: content.len(),
        content,
    })
}

#[tauri::command]
pub fn agent_escribir_archivo(
    workspace_path: String,
    ruta: String,
    contenido: String,
) -> Result<AgentWriteResult, String> {
    let full = resolve_within_workspace(&workspace_path, &ruta)?;
    let existed = full.exists();
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create parent failed: {e}"))?;
    }
    fs::write(&full, contenido.as_bytes()).map_err(|e| format!("write file failed: {e}"))?;
    Ok(AgentWriteResult {
        path: normalize_path(&full),
        existed,
        bytes: contenido.len(),
    })
}

#[tauri::command]
pub fn agent_listar_carpeta(workspace_path: String, ruta: String) -> Result<AgentListResult, String> {
    let full = resolve_within_workspace(&workspace_path, &ruta)?;
    let entries = fs::read_dir(&full)
        .map_err(|e| format!("read dir failed: {e}"))?
        .filter_map(Result::ok)
        .map(|e| {
            let kind = if e.path().is_dir() { "directory" } else { "file" };
            AgentListEntry {
                name: e.file_name().to_string_lossy().to_string(),
                entry_type: kind.into(),
            }
        })
        .collect::<Vec<_>>();

    Ok(AgentListResult {
        path: normalize_path(&full),
        entries,
    })
}

#[tauri::command]
pub fn agent_buscar_en_proyecto(
    workspace_path: String,
    texto: String,
) -> Result<AgentSearchResult, String> {
    if texto.trim().is_empty() {
        return Err("texto is required".into());
    }

    let workspace = PathBuf::from(&workspace_path);
    let mut matches = Vec::new();
    let mut truncated = false;

    for entry in WalkDir::new(&workspace).into_iter().filter_map(Result::ok) {
        if matches.len() >= MAX_SEARCH_RESULTS {
            truncated = true;
            break;
        }

        let path = entry.path();
        let file_name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if file_name == "node_modules"
            || file_name == "dist"
            || file_name == "target"
            || file_name == ".git"
        {
            continue;
        }

        if !path.is_file() {
            continue;
        }

        if let Some(content) = read_text_file_safe(path) {
            for (idx, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&texto.to_lowercase()) {
                    matches.push(AgentSearchMatch {
                        path: normalize_path(path),
                        line: idx + 1,
                        preview: line.trim().to_string(),
                    });
                    if matches.len() >= MAX_SEARCH_RESULTS {
                        truncated = true;
                        break;
                    }
                }
            }
        }
    }

    Ok(AgentSearchResult {
        query: texto,
        matches,
        truncated,
    })
}

#[tauri::command]
pub fn agent_init_context(workspace_path: String) -> Result<AgentInitResult, String> {
    let ws = PathBuf::from(&workspace_path);
    if !ws.exists() {
        return Err("workspace does not exist".into());
    }

    let mut tree_lines = Vec::new();
    for entry in WalkDir::new(&ws)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
    {
        let p = entry.path();
        let rel = p.strip_prefix(&ws).unwrap_or(p);
        if rel.as_os_str().is_empty() {
            continue;
        }
        let level = rel.components().count().saturating_sub(1);
        let prefix = "  ".repeat(level);
        let name = rel
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if name == "node_modules" || name == "dist" || name == "target" || name == ".git" {
            continue;
        }
        tree_lines.push(format!("{}{}", prefix, name));
    }

    let manifests = vec![
        "package.json",
        "tsconfig.json",
        "tailwind.config.js",
        "vite.config.ts",
        "src-tauri/Cargo.toml",
        "src-tauri/tauri.conf.json",
    ];

    let mut manifest_files = Vec::new();
    for rel in manifests {
        let p = ws.join(rel);
        if let Some(content) = read_text_file_safe(&p) {
            manifest_files.push(AgentInitManifestFile {
                path: normalize_path(&p),
                rel_path: rel.to_string(),
                content,
            });
        }
    }

    Ok(AgentInitResult {
        tree: tree_lines.join("\n"),
        manifest_files,
    })
}

#[tauri::command]
pub fn agent_snapshot_folder(
    workspace_path: String,
    folder_path: String,
) -> Result<Vec<AgentSnapshotFile>, String> {
    let folder = resolve_within_workspace(&workspace_path, &folder_path)?;
    if !folder.exists() {
        return Err("folder does not exist".into());
    }

    let ws = PathBuf::from(&workspace_path);
    let mut out = Vec::new();

    for entry in WalkDir::new(&folder)
        .max_depth(6)
        .into_iter()
        .filter_map(Result::ok)
    {
        if out.len() >= MAX_SNAPSHOT_FILES {
            break;
        }
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        if let Some(content) = read_text_file_safe(p) {
            let rel = p
                .strip_prefix(&ws)
                .unwrap_or(p)
                .to_string_lossy()
                .to_string();
            out.push(AgentSnapshotFile {
                path: normalize_path(p),
                rel_path: rel,
                content,
            });
        }
    }

    Ok(out)
}

#[tauri::command]
pub fn agent_file_exists(workspace_path: String, ruta: String) -> Result<bool, String> {
    let full = resolve_within_workspace(&workspace_path, &ruta)?;
    Ok(full.exists())
}

#[tauri::command]
pub fn agent_read_file_safe(workspace_path: String, ruta: String) -> Result<Option<String>, String> {
    let full = resolve_within_workspace(&workspace_path, &ruta)?;
    Ok(read_text_file_safe(&full))
}
