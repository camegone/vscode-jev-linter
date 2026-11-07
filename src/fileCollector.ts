import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { LinterConfig } from './config';

export interface GitignoreRule {
  regex: RegExp;
  negate: boolean;
  directoryOnly: boolean;
  baseDir: string;
}

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  javascript: ['.js', '.mjs', '.cjs'],
  typescript: ['.ts', '.mts', '.cts'],
  javascriptreact: ['.jsx'],
  typescriptreact: ['.tsx'],
  python: ['.py'],
  go: ['.go'],
  php: ['.php'],
  ruby: ['.rb'],
  java: ['.java'],
  c: ['.c', '.h'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
  csharp: ['.cs'],
  rust: ['.rs']
};

/**
 * .gitignore の 1 行（glob パターン）を正規表現に変換
 */
function globToRegex(glob: string): RegExp {
  const fromRoot = glob.startsWith('/');
  if (fromRoot) {
    glob = glob.slice(1);
  }

  let regexStr = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          regexStr += '(?:.*/)?';
          i += 3;
          continue;
        } else {
          regexStr += '.*';
          i += 2;
          continue;
        }
      } else {
        regexStr += '[^/]*';
        i += 1;
        continue;
      }
    } else if (c === '?') {
      regexStr += '[^/]';
      i += 1;
      continue;
    } else if (['.', '(', ')', '+', '|', '^', '$', '{', '}', '[', ']', '\\'].includes(c)) {
      regexStr += '\\' + c;
      i += 1;
      continue;
    } else {
      regexStr += c;
      i += 1;
      continue;
    }
  }

  if (fromRoot) {
    return new RegExp(`^${regexStr}(?:/|$)`);
  } else {
    return new RegExp(`(?:^|/)${regexStr}(?:/|$)`);
  }
}

/**
 * .gitignore ファイルの文字列を行ごとにパースしてルール配列を生成
 */
export function parseGitignoreContent(content: string, baseDir: string = ''): GitignoreRule[] {
  const lines = content.split(/\r?\n/);
  const rules: GitignoreRule[] = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1).trim();
    }

    const directoryOnly = line.endsWith('/');
    if (directoryOnly) {
      line = line.slice(0, -1);
    }

    if (!line) {
      continue;
    }

    try {
      const regex = globToRegex(line);
      rules.push({ regex, negate, directoryOnly, baseDir });
    } catch {
      // 不正なパターンの場合はスキップ
    }
  }

  return rules;
}

/**
 * パスが .gitignore ルールによって除外されるかを判定
 */
export function isPathIgnoredByGitignore(
  relPath: string,
  isDirectory: boolean,
  rules: GitignoreRule[]
): boolean {
  let ignored = false;
  const normalizedPath = relPath.replace(/\\/g, '/');

  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) {
      continue;
    }

    let targetPath = normalizedPath;
    if (rule.baseDir) {
      if (!normalizedPath.startsWith(rule.baseDir + '/')) {
        continue;
      }
      targetPath = normalizedPath.slice(rule.baseDir.length + 1);
    }

    if (rule.regex.test(targetPath)) {
      ignored = !rule.negate;
    }
  }

  return ignored;
}

/**
 * 対象言語の拡張子セットを取得
 */
export function getSupportedExtensions(supportedLanguages: string[]): Set<string> {
  const extSet = new Set<string>();
  for (const lang of supportedLanguages) {
    const exts = LANGUAGE_EXTENSIONS[lang];
    if (exts) {
      for (const e of exts) {
        extSet.add(e.toLowerCase());
      }
    }
  }
  return extSet;
}

/**
 * 指定ディレクトリ配下のスキャン対象ファイルを収集
 */
export async function collectFilesToScan(
  rootDir: string,
  config: LinterConfig,
  token?: vscode.CancellationToken
): Promise<string[]> {
  const results: string[] = [];
  const supportedExts = getSupportedExtensions(config.supportedLanguages);

  let excludeRegex: RegExp | null = null;
  if (config.excludePattern) {
    try {
      excludeRegex = new RegExp(config.excludePattern, 'i');
    } catch (e) {
      console.warn('Jev Linter: Invalid excludePattern regex:', e);
    }
  }

  let includeRegex: RegExp | null = null;
  if (config.includePattern) {
    try {
      includeRegex = new RegExp(config.includePattern, 'i');
    } catch (e) {
      console.warn('Jev Linter: Invalid includePattern regex:', e);
    }
  }

  const visitedDirs = new Set<string>();

  // 再帰トラバース
  function traverse(currentDir: string, currentRules: GitignoreRule[]) {
    if (token?.isCancellationRequested) {
      return;
    }

    let realPath = currentDir;
    try {
      realPath = fs.realpathSync(currentDir);
    } catch {
      // 存在しない・アクセス不可
      return;
    }

    if (visitedDirs.has(realPath)) {
      return; // シンボリックリンク等による循環防止
    }
    visitedDirs.add(realPath);

    // .gitignore の読み込み
    const rules = [...currentRules];
    if (config.useGitignore) {
      const gitignorePath = path.join(currentDir, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        try {
          const content = fs.readFileSync(gitignorePath, 'utf8');
          const relBase = path.relative(rootDir, currentDir).replace(/\\/g, '/');
          const newRules = parseGitignoreContent(content, relBase === '.' ? '' : relBase);
          rules.push(...newRules);
        } catch (e) {
          console.warn(`Jev Linter: Could not read .gitignore at ${gitignorePath}:`, e);
        }
      }
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (token?.isCancellationRequested) {
        return;
      }

      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        // デフォルトで .git ディレクトリは即時スキップ
        if (entry.name === '.git') {
          continue;
        }

        // excludePattern チェック
        if (excludeRegex && excludeRegex.test(relPath)) {
          continue;
        }

        // .gitignore チェック
        if (config.useGitignore && isPathIgnoredByGitignore(relPath, true, rules)) {
          continue;
        }

        traverse(fullPath, rules);
      } else if (entry.isFile()) {
        // excludePattern チェック
        if (excludeRegex && excludeRegex.test(relPath)) {
          continue;
        }

        // .gitignore チェック
        if (config.useGitignore && isPathIgnoredByGitignore(relPath, false, rules)) {
          continue;
        }

        // includePattern チェック（設定されている場合）
        if (includeRegex && !includeRegex.test(relPath)) {
          continue;
        }

        // 拡張子チェック
        const ext = path.extname(entry.name).toLowerCase();
        if (supportedExts.size > 0 && !supportedExts.has(ext)) {
          continue;
        }

        results.push(fullPath);
      }
    }
  }

  traverse(rootDir, []);
  return results;
}
