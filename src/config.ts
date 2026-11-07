import * as vscode from 'vscode';

export interface LinterConfig {
  apiKey: string;
  apiEndpoint: string;
  model: string;
  threshold: number;
  maxBranchCount: number;
  minimumBlockSize: number;
  overlapRatio: number;
  maxChunkChars: number;
  concurrency: number;
  scanOnSave: boolean;
  warnUnresolvedBlocks: boolean;
  supportedLanguages: string[];
  enableCache: boolean;
  cacheMaxEntries: number;
  includePattern: string;
  excludePattern: string;
  useGitignore: boolean;
}

export function getLinterConfig(): LinterConfig {
  const config = vscode.workspace.getConfiguration('jevLinter');
  const configuredKey = config.get<string>('apiKey', '').trim();
  const envKey = (process.env.OPENROUTER_API_KEY || '').trim();

  return {
    apiKey: configuredKey || envKey,
    apiEndpoint: config
      .get<string>('apiEndpoint', 'https://openrouter.ai/api/v1/systemone')
      .trim(),
    model: config.get<string>('model', '~typesafe/jev-latest').trim(),
    threshold: config.get<number>('threshold', 0.65),
    maxBranchCount: Math.min(64, Math.max(2, config.get<number>('maxBranchCount', 8))),
    minimumBlockSize: Math.max(1, config.get<number>('minimumBlockSize', 1)),
    overlapRatio: Math.min(0.4, Math.max(0.0, config.get<number>('overlapRatio', 0.15))),
    maxChunkChars: Math.max(1000, config.get<number>('maxChunkChars', 60000)),
    concurrency: Math.max(1, config.get<number>('concurrency', 4)),
    scanOnSave: config.get<boolean>('scanOnSave', true),
    warnUnresolvedBlocks: config.get<boolean>('warnUnresolvedBlocks', false),
    supportedLanguages: config.get<string[]>('supportedLanguages', [
      'javascript',
      'typescript',
      'javascriptreact',
      'typescriptreact',
      'python',
      'go',
      'php',
      'ruby',
      'java',
      'c',
      'cpp',
      'csharp',
      'rust'
    ]),
    enableCache: config.get<boolean>('enableCache', true),
    cacheMaxEntries: Math.max(100, config.get<number>('cacheMaxEntries', 2000)),
    includePattern: config.get<string>('includePattern', '').trim(),
    excludePattern: config
      .get<string>('excludePattern', 'node_modules|\\.git|dist|out|build|vendor')
      .trim(),
    useGitignore: config.get<boolean>('useGitignore', true)
  };
}

export async function promptForApiKey(): Promise<string | undefined> {
  const openSettings = vscode.l10n.t('Open Settings');
  const selection = await vscode.window.showWarningMessage(
    vscode.l10n.t(
      'Jev Linter: OpenRouter API key is not configured. Please enter it in settings or set the OPENROUTER_API_KEY environment variable.'
    ),
    openSettings
  );
  if (selection === openSettings) {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'jevLinter.apiKey');
  }
  return undefined;
}
