use crate::models::{WorkspaceSearchMatch, WorkspaceSearchResult, WorkspaceReplaceResult};
use crate::utils::{normalize_path, read_text_file_safe};
use regex::Regex;
use std::fs;
use std::path::PathBuf;
use walkdir::WalkDir;

const MAX_SEARCH_RESULTS: usize = 500;

fn is_excluded_dir(e: &walkdir::DirEntry) -> bool {
    if e.depth() == 0 {
        return false;
    }
    let name = e.file_name().to_string_lossy();
    matches!(
        name.as_ref(),
        "node_modules" | "dist" | "target" | ".git" | ".quebracho"
    )
}

fn build_search_regex(
    query: &str,
    match_case: bool,
    whole_word: bool,
    use_regex: bool,
) -> Result<Regex, String> {
    let pattern = if use_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };

    let pattern = if whole_word {
        format!(r"\b(?:{})\b", pattern)
    } else {
        pattern
    };

    let pattern = if match_case {
        pattern
    } else {
        format!("(?i){}", pattern)
    };

    Regex::new(&pattern).map_err(|e| format!("invalid regex: {}", e))
}

#[tauri::command]
pub fn workspace_search(
    workspace_path: String,
    query: String,
    match_case: bool,
    whole_word: bool,
    use_regex: bool,
) -> Result<WorkspaceSearchResult, String> {
    if query.trim().is_empty() {
        return Err("query is required".into());
    }

    let re = build_search_regex(&query, match_case, whole_word, use_regex)?;
    let workspace = PathBuf::from(&workspace_path);
    let mut matches = Vec::new();
    let mut truncated = false;

    for entry in WalkDir::new(&workspace)
        .into_iter()
        .filter_entry(|e| !is_excluded_dir(e))
        .filter_map(Result::ok)
    {
        if matches.len() >= MAX_SEARCH_RESULTS {
            truncated = true;
            break;
        }

        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        if let Some(content) = read_text_file_safe(path) {
            for (idx, line) in content.lines().enumerate() {
                if re.is_match(line) {
                    matches.push(WorkspaceSearchMatch {
                        path: normalize_path(path),
                        line: idx + 1,
                        preview: line.to_string(),
                    });
                    if matches.len() >= MAX_SEARCH_RESULTS {
                        truncated = true;
                        break;
                    }
                }
            }
        }
    }

    Ok(WorkspaceSearchResult {
        query,
        matches,
        truncated,
    })
}

#[tauri::command]
pub fn workspace_replace(
    workspace_path: String,
    query: String,
    replacement: String,
    match_case: bool,
    whole_word: bool,
    use_regex: bool,
    target_path: Option<String>,
) -> Result<WorkspaceReplaceResult, String> {
    if query.trim().is_empty() {
        return Err("query is required".into());
    }

    let re = build_search_regex(&query, match_case, whole_word, use_regex)?;
    let workspace = PathBuf::from(&workspace_path);
    let mut files_modified = 0;
    let mut replacements_count = 0;

    if let Some(tp) = target_path {
        let path = workspace.join(&tp);
        if !path.is_file() {
            return Err("target file does not exist".into());
        }
        if let Some(content) = read_text_file_safe(&path) {
            let new_content = re.replace_all(&content, replacement.as_str());
            if new_content != content {
                let count = re.find_iter(&content).count();
                replacements_count += count;
                fs::write(&path, new_content.as_bytes())
                    .map_err(|e| format!("write failed for {}: {}", path.display(), e))?;
                files_modified += 1;
            }
        }
    } else {
        for entry in WalkDir::new(&workspace)
            .into_iter()
            .filter_entry(|e| !is_excluded_dir(e))
            .filter_map(Result::ok)
        {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            if let Some(content) = read_text_file_safe(path) {
                let new_content = re.replace_all(&content, replacement.as_str());
                if new_content != content {
                    let count = re.find_iter(&content).count();
                    replacements_count += count;
                    fs::write(path, new_content.as_bytes())
                        .map_err(|e| format!("write failed for {}: {}", path.display(), e))?;
                    files_modified += 1;
                }
            }
        }
    }

    Ok(WorkspaceReplaceResult {
        files_modified,
        replacements_count,
    })
}
