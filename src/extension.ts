import * as vscode from 'vscode';
import { getLinterConfig, promptForApiKey } from './config';
import { Scanner } from './scanner';
import { HttpError } from './jevClient';
import { decisionCache } from './cache';

let diagnosticCollection: vscode.DiagnosticCollection;
let statusBarItem: vscode.StatusBarItem;
const activeScanCancellations = new Map<string, vscode.CancellationTokenSource>();

let lastErrorToastTime = 0;
let lastErrorCode: number | null = null;

export function activate(context: vscode.ExtensionContext) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('jev-security');
  context.subscriptions.push(diagnosticCollection);

  // ステータスバーアイテムの作成
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'jevLinter.scanCurrentFile';
  statusBarItem.text = '$(shield) Jev';
  statusBarItem.tooltip = vscode.l10n.t('Jev Security Linter: Click to scan current file');
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // ファイル保存時のフック
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      const config = getLinterConfig();
      if (!config.scanOnSave) {
        return;
      }
      if (!config.supportedLanguages.includes(document.languageId)) {
        return;
      }
      await runScan(document, false);
    })
  );

  // ドキュメントを閉じた時に診断情報をクリア
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnosticCollection.delete(document.uri);
      const uriStr = document.uri.toString();
      if (activeScanCancellations.has(uriStr)) {
        activeScanCancellations.get(uriStr)!.cancel();
        activeScanCancellations.delete(uriStr);
      }
    })
  );

  // コマンド: 現在のファイルをスキャン
  context.subscriptions.push(
    vscode.commands.registerCommand('jevLinter.scanCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage(
          vscode.l10n.t('Jev Linter: No active editor opened.')
        );
        return;
      }
      await runScan(editor.document, true);
    })
  );

  // コマンド: 診断結果をクリア
  context.subscriptions.push(
    vscode.commands.registerCommand('jevLinter.clearDiagnostics', () => {
      diagnosticCollection.clear();
      vscode.window.showInformationMessage(
        vscode.l10n.t('Jev Linter: All diagnostics cleared.')
      );
    })
  );

  // コマンド: 判定キャッシュをクリア
  context.subscriptions.push(
    vscode.commands.registerCommand('jevLinter.clearCache', () => {
      const count = decisionCache.clear();
      vscode.window.showInformationMessage(
        vscode.l10n.t('Jev Linter: Cache cleared ({0} entries removed).', count)
      );
    })
  );
}

let hasWarnedMissingApiKey = false;

async function runScan(document: vscode.TextDocument, isManual: boolean) {
  const config = getLinterConfig();

  // APIキー未設定のチェック
  if (!config.apiKey) {
    if (isManual || !hasWarnedMissingApiKey) {
      hasWarnedMissingApiKey = true;
      await promptForApiKey();
    }
    return;
  }

  const uriStr = document.uri.toString();

  // 既存の進行中スキャンがあればキャンセル
  if (activeScanCancellations.has(uriStr)) {
    activeScanCancellations.get(uriStr)!.cancel();
    activeScanCancellations.delete(uriStr);
  }

  const cts = new vscode.CancellationTokenSource();
  activeScanCancellations.set(uriStr, cts);

  statusBarItem.text = vscode.l10n.t('$(sync~spin) Jev: Scanning...');
  statusBarItem.tooltip = vscode.l10n.t(
    'Jev Linter: Scanning {0}',
    document.fileName
  );

  const scanner = new Scanner(config);

  try {
    const diagnostics = await scanner.scanDocument(document, cts.token);

    if (cts.token.isCancellationRequested) {
      return;
    }

    diagnosticCollection.set(document.uri, diagnostics);

    if (diagnostics.length > 0) {
      statusBarItem.text = vscode.l10n.t(
        '$(alert) Jev: Vulnerability detected ({0})',
        diagnostics.length
      );
      if (isManual) {
        const lineLocations = diagnostics.map((d) => {
          const s = d.range.start.line + 1;
          const e = d.range.end.line + 1;
          return s === e ? `L${s}` : `L${s}-${e}`;
        });
        const summaryStr =
          lineLocations.length <= 3
            ? lineLocations.join(', ')
            : `${lineLocations.slice(0, 3).join(', ')}...`;

        vscode.window.showWarningMessage(
          vscode.l10n.t(
            'Jev Linter: Detected {0} security risk location(s) ({1}).',
            diagnostics.length,
            summaryStr
          )
        );
      }
    } else {
      statusBarItem.text = vscode.l10n.t('$(check) Jev: Clean');
      if (isManual) {
        vscode.window.showInformationMessage(
          vscode.l10n.t('Jev Linter: No security vulnerabilities found.')
        );
      }
    }
  } catch (err: any) {
    if (!cts.token.isCancellationRequested) {
      console.error('Jev Linter scan failed:', err);

      if (err instanceof HttpError) {
        handleHttpError(err, isManual);
      } else {
        statusBarItem.text = vscode.l10n.t('$(error) Jev: Error');
        statusBarItem.tooltip = vscode.l10n.t(
          'Jev Linter scan error: {0}',
          err.message || err
        );
        if (isManual) {
          vscode.window.showErrorMessage(
            vscode.l10n.t('Jev Linter scan error: {0}', err.message || err)
          );
        }
      }
    }
  } finally {
    if (activeScanCancellations.get(uriStr) === cts) {
      activeScanCancellations.delete(uriStr);
      // 数秒後にステータスバーを通常表示に戻す
      setTimeout(() => {
        statusBarItem.text = '$(shield) Jev';
        statusBarItem.tooltip = vscode.l10n.t(
          'Jev Security Linter: Click to scan current file'
        );
      }, 5000);
    }
    cts.dispose();
  }
}

function handleHttpError(err: HttpError, isManual: boolean) {
  statusBarItem.text = vscode.l10n.t('$(error) Jev: HTTP {0}', err.statusCode);
  statusBarItem.tooltip = `Jev Linter HTTP ${err.statusCode}: ${err.message}`;

  let friendlyMessage = vscode.l10n.t(
    'Jev Linter: HTTP {0} ({1})',
    err.statusCode,
    err.statusText
  );
  if (err.statusCode === 401) {
    friendlyMessage = vscode.l10n.t(
      'Jev Linter: HTTP 401 (Unauthorized) - Invalid API key or unauthorized. Please check settings.'
    );
  } else if (err.statusCode === 402) {
    friendlyMessage = vscode.l10n.t(
      'Jev Linter: HTTP 402 (Payment Required) - Insufficient OpenRouter credit balance.'
    );
  } else if (err.statusCode === 429) {
    friendlyMessage = vscode.l10n.t(
      'Jev Linter: HTTP 429 (Too Many Requests) - Rate limit exceeded. Please try again later.'
    );
  } else if (err.statusCode === 400) {
    friendlyMessage = vscode.l10n.t(
      'Jev Linter: HTTP 400 (Bad Request) - {0}',
      err.responseBody || 'Invalid request format'
    );
  } else if (err.statusCode >= 500) {
    friendlyMessage = vscode.l10n.t(
      'Jev Linter: HTTP {0} ({1}) - OpenRouter server error occurred.',
      err.statusCode,
      err.statusText
    );
  }

  // 手動実行時は必ず表示。自動スキャン時は同一エラーの連続トーストを10秒抑制
  const now = Date.now();
  if (isManual || lastErrorCode !== err.statusCode || now - lastErrorToastTime > 10000) {
    lastErrorToastTime = now;
    lastErrorCode = err.statusCode;
    vscode.window.showErrorMessage(friendlyMessage);
  }
}

export function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.clear();
  }
  for (const cts of activeScanCancellations.values()) {
    cts.cancel();
    cts.dispose();
  }
  activeScanCancellations.clear();
}
