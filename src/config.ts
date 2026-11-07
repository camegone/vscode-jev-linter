import * as vscode from 'vscode';

export type DiagnosticSeverityType = 'Error' | 'Warning' | 'Information' | 'Hint';

export interface LinterRule {
  id: string;
  name: string;
  enabled: boolean;
  severity: DiagnosticSeverityType;
  target: string;
  message: string;
}

export const DEFAULT_RULES: LinterRule[] = [
  {
    id: 'security',
    name: 'Security Vulnerabilities',
    enabled: true,
    severity: 'Warning',
    target: 'security vulnerabilities, command injections, SQL injections, hardcoded credentials, unsanitized executions',
    message: 'Jev [Security]: Potential security risk/vulnerability detected'
  },
  {
    id: 'typo',
    name: 'Typos & Spelling',
    enabled: false,
    severity: 'Information',
    target: 'spelling mistakes, obvious typos in comments, string literals, error messages, or identifiers',
    message: 'Jev [Typo]: Potential typo or spelling mistake detected'
  },
  {
    id: 'policy',
    name: 'Style & Policy Violations',
    enabled: false,
    severity: 'Warning',
    target: 'policy violations, leftover debug prints/console.log, empty catch blocks swallowing errors, hardcoded environment URLs',
    message: 'Jev [Policy]: Potential policy violation or leftover debug code detected'
  },
  {
    id: 'redundancy',
    name: 'Redundancy & Dead Code',
    enabled: false,
    severity: 'Information',
    target: 'redundant code, unreachable statements, unnecessary temporary variables, needlessly complex conditions, reinvented built-in utils',
    message: 'Jev [Redundancy]: Potential redundant or dead code detected'
  },
  {
    id: 'legacy',
    name: 'Legacy & Deprecated Practices',
    enabled: false,
    severity: 'Information',
    target: 'deprecated syntax or outdated APIs, legacy idioms where modern language alternatives exist (e.g. var, callback hell)',
    message: 'Jev [Legacy]: Potential deprecated API or legacy syntax detected'
  },
  {
    id: 'performance',
    name: 'Performance & Resource Leaks',
    enabled: false,
    severity: 'Warning',
    target: 'performance anti-patterns, N+1 queries in loops, unclosed file or connection resources, costly repeated allocations in loops',
    message: 'Jev [Perf]: Potential resource leak or performance pitfall detected'
  },
  {
    id: 'robustness',
    name: 'Robustness & Edge Cases',
    enabled: false,
    severity: 'Warning',
    target: 'robustness issues, unhandled potential null/undefined dereferences, missing error handling for I/O, unprotected division by zero',
    message: 'Jev [Robustness]: Potential missing error handling or edge-case guard detected'
  }
];

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
  rules: LinterRule[];
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
    useGitignore: config.get<boolean>('useGitignore', true),
    rules: (() => {
      const configuredRules = config.get<LinterRule[]>('rules', []);
      if (!configuredRules || configuredRules.length === 0) {
        return DEFAULT_RULES;
      }
      return configuredRules.map((r) => ({
        id: r.id || 'custom',
        name: r.name || 'Custom Rule',
        enabled: r.enabled !== false,
        severity: r.severity || 'Warning',
        target: r.target || 'general issues',
        message: r.message || 'Jev: Potential issue detected'
      }));
    })()
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
