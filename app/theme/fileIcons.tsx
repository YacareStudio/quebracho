import type { LucideIcon } from 'lucide-react';
import {
  File as FileIcon,
  FileArchive,
  FileAudio2,
  FileCode2,
  FileImage,
  FileJson2,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo2,
  Folder,
  FolderOpen,
} from 'lucide-react';
import type { FileIconThemeId } from './appearance';

const materialColors = {
  folder: '#E8B14B',
  folderOpen: '#F1C76A',
  ts: '#519ABA',
  js: '#F7DF1E',
  jsx: '#61DAFB',
  tsx: '#61DAFB',
  json: '#CB9C34',
  md: '#6EA8FE',
  css: '#42A5F5',
  scss: '#CF649A',
  html: '#E44D26',
  rust: '#DEA584',
  go: '#00ADD8',
  py: '#4B8BBE',
  image: '#8AD7FF',
  audio: '#C792EA',
  video: '#FF8A65',
  archive: '#FFB74D',
  text: '#BFC4CF',
};

type IconSpec = {
  icon: LucideIcon;
  color: string;
};

function getExtension(name: string): string {
  const normalized = name.trim().toLowerCase();
  const idx = normalized.lastIndexOf('.');
  if (idx <= 0 || idx === normalized.length - 1) return '';
  return normalized.slice(idx + 1);
}

function resolveMaterialFileIcon(fileName: string): IconSpec {
  const ext = getExtension(fileName);

  if (['ts', 'mts', 'cts'].includes(ext)) return { icon: FileCode2, color: materialColors.ts };
  if (['tsx'].includes(ext)) return { icon: FileCode2, color: materialColors.tsx };
  if (['js', 'mjs', 'cjs'].includes(ext)) return { icon: FileCode2, color: materialColors.js };
  if (['jsx'].includes(ext)) return { icon: FileCode2, color: materialColors.jsx };
  if (['json', 'jsonc'].includes(ext)) return { icon: FileJson2, color: materialColors.json };
  if (['md', 'mdx'].includes(ext)) return { icon: FileText, color: materialColors.md };
  if (['css'].includes(ext)) return { icon: FileType2, color: materialColors.css };
  if (['scss', 'sass', 'less'].includes(ext)) return { icon: FileType2, color: materialColors.scss };
  if (['html', 'htm'].includes(ext)) return { icon: FileCode2, color: materialColors.html };
  if (['rs'].includes(ext)) return { icon: FileCode2, color: materialColors.rust };
  if (['go'].includes(ext)) return { icon: FileCode2, color: materialColors.go };
  if (['py'].includes(ext)) return { icon: FileCode2, color: materialColors.py };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) {
    return { icon: FileImage, color: materialColors.image };
  }
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) {
    return { icon: FileAudio2, color: materialColors.audio };
  }
  if (['mp4', 'mkv', 'webm', 'avi', 'mov'].includes(ext)) {
    return { icon: FileVideo2, color: materialColors.video };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return { icon: FileArchive, color: materialColors.archive };
  }
  if (['csv', 'xlsx', 'xls'].includes(ext)) {
    return { icon: FileSpreadsheet, color: '#7FC97F' };
  }

  return { icon: FileIcon, color: materialColors.text };
}

export function ExplorerNodeIcon({
  theme,
  type,
  fileName,
  expanded,
  active,
}: {
  theme: FileIconThemeId;
  type: 'file' | 'directory';
  fileName: string;
  expanded: boolean;
  active: boolean;
}): JSX.Element {
  if (theme === 'classic') {
    if (type === 'directory') {
      const FolderCmp = expanded ? FolderOpen : Folder;
      return <FolderCmp size={15} style={{ color: active ? '#4ADB94' : '#D0D3DA' }} />;
    }
    return <FileIcon size={14} style={{ color: active ? '#FFFFFF' : '#D0D3DA' }} />;
  }

  if (type === 'directory') {
    const FolderCmp = expanded ? FolderOpen : Folder;
    return (
      <FolderCmp
        size={15}
        style={{ color: active ? '#F4C96D' : expanded ? materialColors.folderOpen : materialColors.folder }}
      />
    );
  }

  const resolved = resolveMaterialFileIcon(fileName);
  const FileCmp = resolved.icon;
  return <FileCmp size={14} style={{ color: active ? '#FFFFFF' : resolved.color }} />;
}
