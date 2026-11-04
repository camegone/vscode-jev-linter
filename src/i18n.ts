export type MessageKey =
  | 'status.ready'
  | 'status.scanning'
  | 'status.scanningTooltip'
  | 'status.detected'
  | 'status.clean'
  | 'status.error'
  | 'status.httpError'
  | 'diag.warning'
  | 'diag.oversizedLine'
  | 'toast.missingApiKey'
  | 'toast.openSettings'
  | 'toast.noActiveEditor'
  | 'toast.diagnosticsCleared'
  | 'toast.detectedWarning'
  | 'toast.cleanInfo'
  | 'toast.scanError'
  | 'toast.http401'
  | 'toast.http402'
  | 'toast.http429'
  | 'toast.http400'
  | 'toast.http5xx'
  | 'toast.httpGeneral';

const enMessages: Record<MessageKey, string> = {
  'status.ready': 'Jev',
  'status.scanning': '$(sync~spin) Jev: Scanning...',
  'status.scanningTooltip': 'Jev Linter: Scanning {0}',
  'status.detected': '$(alert) Jev: Vulnerability detected ({0})',
  'status.clean': '$(check) Jev: Clean',
  'status.error': '$(error) Jev: Error',
  'status.httpError': '$(error) Jev: HTTP {0}',
  'diag.warning': 'Jev: Potential security risk/vulnerability detected (confidence: {0}%)',
  'diag.oversizedLine':
    'Jev: This line is too large for AI verification and was skipped ({0} chars). Malicious code might be concealed at the end; please verify manually.',
  'toast.missingApiKey':
    'Jev Linter: OpenRouter API key is not configured. Please enter it in settings or set the OPENROUTER_API_KEY environment variable.',
  'toast.openSettings': 'Open Settings',
  'toast.noActiveEditor': 'Jev Linter: No active editor opened.',
  'toast.diagnosticsCleared': 'Jev Linter: All diagnostics cleared.',
  'toast.detectedWarning': 'Jev Linter: Detected {0} security risk location(s).',
  'toast.cleanInfo': 'Jev Linter: No security vulnerabilities found.',
  'toast.scanError': 'Jev Linter scan error: {0}',
  'toast.http401':
    'Jev Linter: HTTP 401 (Unauthorized) - Invalid API key or unauthorized. Please check settings.',
  'toast.http402':
    'Jev Linter: HTTP 402 (Payment Required) - Insufficient OpenRouter credit balance.',
  'toast.http429':
    'Jev Linter: HTTP 429 (Too Many Requests) - Rate limit exceeded. Please try again later.',
  'toast.http400': 'Jev Linter: HTTP 400 (Bad Request) - {0}',
  'toast.http5xx':
    'Jev Linter: HTTP {0} ({1}) - OpenRouter server error occurred.',
  'toast.httpGeneral': 'Jev Linter: HTTP {0} ({1})'
};

const jaMessages: Record<MessageKey, string> = {
  'status.ready': 'Jev',
  'status.scanning': '$(sync~spin) Jev: スキャン中...',
  'status.scanningTooltip': 'Jev Linter: {0} をスキャンしています',
  'status.detected': '$(alert) Jev: 脆弱性検出 ({0}件)',
  'status.clean': '$(check) Jev: 問題なし',
  'status.error': '$(error) Jev: エラー',
  'status.httpError': '$(error) Jev: HTTP {0}',
  'diag.warning': 'Jev: セキュリティリスク・脆弱性の可能性を検出しました (確信度: {0}%)',
  'diag.oversizedLine':
    'Jev: この行は長大すぎるためAI検証をスキップしました ({0}文字)。行末に不正なコードが隠蔽されている可能性があるため、手動で確認してください。',
  'toast.missingApiKey':
    'Jev Linter: OpenRouter APIキーが設定されていません。設定画面で入力するか環境変数 OPENROUTER_API_KEY を設定してください。',
  'toast.openSettings': '設定を開く',
  'toast.noActiveEditor': 'Jev Linter: 開いているエディタがありません。',
  'toast.diagnosticsCleared': 'Jev Linter: すべての診断結果をクリアしました。',
  'toast.detectedWarning': 'Jev Linter: {0} 箇所のセキュリティリスクを検出しました。',
  'toast.cleanInfo': 'Jev Linter: セキュリティ脆弱性は検出されませんでした。',
  'toast.scanError': 'Jev Linter スキャンエラー: {0}',
  'toast.http401':
    'Jev Linter: HTTP 401 (Unauthorized) - APIキーが無効か、権限がありません。設定を確認してください。',
  'toast.http402':
    'Jev Linter: HTTP 402 (Payment Required) - OpenRouter のクレジット残高が不足しています。',
  'toast.http429':
    'Jev Linter: HTTP 429 (Too Many Requests) - レート制限に達しました。しばらく待ってから再試行してください。',
  'toast.http400': 'Jev Linter: HTTP 400 (Bad Request) - {0}',
  'toast.http5xx':
    'Jev Linter: HTTP {0} ({1}) - OpenRouter 側でサーバーエラーが発生しました。',
  'toast.httpGeneral': 'Jev Linter: HTTP {0} ({1})'
};

let testLanguageOverride: string | null = null;

export function setLanguageForTesting(lang: string | null) {
  testLanguageOverride = lang;
}

export function isJapanese(): boolean {
  if (testLanguageOverride !== null) {
    return testLanguageOverride.toLowerCase().startsWith('ja');
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode');
    const lang = (vscode?.env?.language || '').toLowerCase();
    return lang.startsWith('ja');
  } catch {
    return false;
  }
}

export function t(key: MessageKey, ...args: (string | number)[]): string {
  const dict = isJapanese() ? jaMessages : enMessages;
  let template = dict[key] || enMessages[key] || key;

  for (let i = 0; i < args.length; i++) {
    template = template.replace(new RegExp(`\\{${i}\\}`, 'g'), String(args[i]));
  }

  return template;
}
