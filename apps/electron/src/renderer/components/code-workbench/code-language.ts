const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'tsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.json': 'json',
  '.jsonc': 'json',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.htm': 'html',
  '.xml': 'xml',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.sql': 'sql',
  '.md': 'markdown',
  '.markdown': 'markdown',
}

export function resolveCodeLanguage(filePath: string, extension?: string): string {
  const normalizedExtension = extension?.toLowerCase()
    || filePath.match(/(\.[^./\\]+)$/)?.[1]?.toLowerCase()
    || ''
  return CODE_LANGUAGE_BY_EXTENSION[normalizedExtension] ?? 'text'
}

export function getLanguageDisplayName(language: string): string {
  const names: Record<string, string> = {
    cpp: 'C++',
    css: 'CSS',
    go: 'Go',
    html: 'HTML',
    java: 'Java',
    javascript: 'JavaScript',
    json: 'JSON',
    markdown: 'Markdown',
    python: 'Python',
    rust: 'Rust',
    shell: 'Shell',
    sql: 'SQL',
    text: 'Plain Text',
    toml: 'TOML',
    tsx: 'TSX',
    typescript: 'TypeScript',
    xml: 'XML',
    yaml: 'YAML',
  }
  return names[language] ?? language.toUpperCase()
}
