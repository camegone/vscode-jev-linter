import * as vscode from 'vscode';
import { t } from './i18n';

export interface LinterConfig {
  apiKey: string;
  apiEndpoint: string;
  model: string;
  threshold: number;
  searchStrategy: 'binarySearch' | 'slidingWindow';
  minimumBlockSize: number;
  overlapRatio: number;
  maxChunkChars: number;
  windowLines: number;
  overlapLines: number;
  concurrency: number;
  scanOnSave: boolean;
  supportedLanguages: string[];
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
    model: config.get<string>('model', 'typesafe/jev-1.13').trim(),
    threshold: config.get<number>('threshold', 0.65),
    searchStrategy: config.get<'binarySearch' | 'slidingWindow'>('searchStrategy', 'binarySearch'),
    minimumBlockSize: Math.max(1, config.get<number>('minimumBlockSize', 4)),
    overlapRatio: Math.min(0.4, Math.max(0.0, config.get<number>('overlapRatio', 0.15))),
    maxChunkChars: Math.max(1000, config.get<number>('maxChunkChars', 60000)),
    windowLines: Math.max(10, config.get<number>('windowLines', 30)),
    overlapLines: Math.max(0, config.get<number>('overlapLines', 10)),
    concurrency: Math.max(1, config.get<number>('concurrency', 4)),
    scanOnSave: config.get<boolean>('scanOnSave', true),
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
    ])
  };
}

export async function promptForApiKey(): Promise<string | undefined> {
  const selection = await vscode.window.showWarningMessage(
    t('toast.missingApiKey'),
    t('toast.openSettings')
  );
  if (selection === t('toast.openSettings')) {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'jevLinter.apiKey');
  }
  return undefined;
}
