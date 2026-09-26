



export const FILE_TYPES = {
  js:        { icon: 'ftJs',        color: '#f1e05a', language: 'javascript', label: 'JavaScript' },
  mjs:       { icon: 'ftJs',        color: '#f1e05a', language: 'javascript', label: 'JavaScript' },
  cjs:       { icon: 'ftJs',        color: '#f1e05a', language: 'javascript', label: 'JavaScript' },
  jsx:       { icon: 'ftReact',     color: '#61dafb', language: 'javascript', label: 'JSX' },
  ts:        { icon: 'ftTs',        color: '#3178c6', language: 'typescript', label: 'TypeScript' },
  tsx:       { icon: 'ftReact',     color: '#3178c6', language: 'typescript', label: 'TSX' },
  py:        { icon: 'ftPython',    color: '#4b8bbe', language: 'python',     label: 'Python' },
  ipynb:     { icon: 'ftPython',    color: '#4b8bbe', language: 'python',     label: 'Notebook' },
  json:      { icon: 'ftJson',      color: '#f5c542', language: 'json',       label: 'JSON' },
  md:        { icon: 'ftMarkdown',  color: '#8b93a3', language: 'markdown',   label: 'Markdown' },
  markdown:  { icon: 'ftMarkdown',  color: '#8b93a3', language: 'markdown',   label: 'Markdown' },
  readme:    { icon: 'ftMarkdown',  color: '#8b93a3', language: 'markdown',   label: 'README' },
  html:      { icon: 'ftHtml',      color: '#e5622a', language: 'html',       label: 'HTML' },
  htm:       { icon: 'ftHtml',      color: '#e5622a', language: 'html',       label: 'HTML' },
  xml:       { icon: 'ftHtml',      color: '#8b93a3', language: 'xml',        label: 'XML' },
  svg:       { icon: 'ftImage',     color: '#ffb13b', language: 'xml',        label: 'SVG' },
  css:       { icon: 'ftCss',       color: '#5a9efd', language: 'css',        label: 'CSS' },
  scss:      { icon: 'ftCss',       color: '#c76494', language: 'css',        label: 'SCSS' },
  less:      { icon: 'ftCss',       color: '#5a9efd', language: 'css',        label: 'Less' },
  sh:        { icon: 'ftTerminal',  color: '#89e051', language: 'bash',       label: 'Shell' },
  bash:      { icon: 'ftTerminal',  color: '#89e051', language: 'bash',       label: 'Bash' },
  zsh:       { icon: 'ftTerminal',  color: '#89e051', language: 'bash',       label: 'Shell' },
  bat:       { icon: 'ftTerminal',  color: '#89e051', language: 'bash',       label: 'Batch' },
  ps1:       { icon: 'ftTerminal',  color: '#5391fe', language: 'bash',       label: 'PowerShell' },
  sql:       { icon: 'ftDatabase',  color: '#dd7c68', language: 'sql',        label: 'SQL' },
  yml:       { icon: 'ftYaml',      color: '#cb5b5b', language: 'yaml',       label: 'YAML' },
  yaml:      { icon: 'ftYaml',      color: '#cb5b5b', language: 'yaml',       label: 'YAML' },
  toml:      { icon: 'ftYaml',      color: '#9c8f7f', language: 'ini',        label: 'TOML' },
  ini:       { icon: 'ftYaml',      color: '#9c8f7f', language: 'ini',        label: 'INI' },
  env:       { icon: 'ftYaml',      color: '#ecd53f', language: 'ini',        label: 'ENV' },
  rs:        { icon: 'ftRust',      color: '#dea584', language: 'rust',       label: 'Rust' },
  go:        { icon: 'ftGo',        color: '#00add8', language: 'go',         label: 'Go' },
  java:      { icon: 'ftJava',      color: '#b07219', language: 'java',       label: 'Java' },
  c:         { icon: 'ftC',         color: '#555555', language: 'cpp',        label: 'C' },
  h:         { icon: 'ftC',         color: '#8b93a3', language: 'cpp',        label: 'Header' },
  cpp:       { icon: 'ftCpp',       color: '#f34b7d', language: 'cpp',        label: 'C++' },
  hpp:       { icon: 'ftCpp',       color: '#f34b7d', language: 'cpp',        label: 'C++' },
  cs:        { icon: 'ftCSharp',    color: '#178600', language: 'csharp',     label: 'C#' },
  php:       { icon: 'ftPhp',       color: '#a071c9', language: 'php',        label: 'PHP' },
  rb:        { icon: 'ftRuby',      color: '#cc342d', language: 'ruby',       label: 'Ruby' },
  txt:       { icon: 'ftText',      color: '#8b93a3', language: 'text',       label: 'Text' },
  log:       { icon: 'ftText',      color: '#8b93a3', language: 'text',       label: 'Log' },
  csv:       { icon: 'ftText',      color: '#237346', language: 'text',       label: 'CSV' },
  pdf:       { icon: 'ftPdf',       color: '#e5555e', language: 'text',       label: 'PDF' },
  png:       { icon: 'ftImage',     color: '#a074c4', language: 'text',       label: 'PNG' },
  jpg:       { icon: 'ftImage',     color: '#a074c4', language: 'text',       label: 'JPG' },
  jpeg:      { icon: 'ftImage',     color: '#a074c4', language: 'text',       label: 'JPEG' },
  gif:       { icon: 'ftImage',     color: '#a074c4', language: 'text',       label: 'GIF' },
  webp:      { icon: 'ftImage',     color: '#a074c4', language: 'text',       label: 'WebP' },
  zip:       { icon: 'ftArchive',   color: '#ceb67f', language: 'text',       label: 'Archive' },
  tar:       { icon: 'ftArchive',   color: '#ceb67f', language: 'text',       label: 'Archive' },
  gz:        { icon: 'ftArchive',   color: '#ceb67f', language: 'text',       label: 'Archive' },
  lock:      { icon: 'ftLock',      color: '#8b93a3', language: 'text',       label: 'Lockfile' },
};


const SPECIAL_NAMES = {
  readme: 'readme',
  'readme.md': 'readme',
  dockerfile: { icon: 'ftDocker', color: '#2496ed', language: 'dockerfile', label: 'Dockerfile' },
  'docker-compose.yml': { icon: 'ftDocker', color: '#2496ed', language: 'yaml', label: 'Compose' },
  'docker-compose.yaml': { icon: 'ftDocker', color: '#2496ed', language: 'yaml', label: 'Compose' },
  makefile: { icon: 'ftTerminal', color: '#ceb67f', language: 'bash', label: 'Makefile' },
  '.gitignore': { icon: 'ftGit', color: '#f14e32', language: 'ini', label: 'Git ignore' },
  '.env': { icon: 'ftYaml', color: '#ecd53f', language: 'ini', label: 'ENV' },
  'package.json': { icon: 'ftNode', color: '#8cc84b', language: 'json', label: 'package.json' },
  license: { icon: 'ftText', color: '#8b93a3', language: 'text', label: 'License' },
};

const FALLBACK = { icon: 'ftFile', color: '#8b93a3', language: 'text', label: 'File' };

export function fileTypeFor(pathOrName) {
  const name = String(pathOrName || '').split(/[\\/]/).pop() || '';
  const lower = name.toLowerCase();
  if (SPECIAL_NAMES[lower]) return FILE_TYPES[SPECIAL_NAMES[lower]] || SPECIAL_NAMES[lower];
  const ext = lower.includes('.') ? lower.split('.').pop() : '';
  return (ext && FILE_TYPES[ext]) || FALLBACK;
}
