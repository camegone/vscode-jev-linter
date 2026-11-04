import * as vscode from 'vscode';
import { getLinterConfig, promptForApiKey } from './config';
import { Scanner } from './scanner';
import { HttpError } from './jevClient';
import { t } from './i18n';

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
  statusBarItem.tooltip = t('status.scanningTooltip', '').replace('Jev Linter: ', '');
  statusBarItem.tooltip = 'Jev Security Linter: Click to scan current file';
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
        vscode.window.showInformationMessage(t('toast.noActiveEditor'));
        return;
      }
      await runScan(editor.document, true);
    })
  );

  // コマンド: 診断結果をクリア
  context.subscriptions.push(
    vscode.commands.registerCommand('jevLinter.clearDiagnostics', () => {
      diagnosticCollection.clear();
      vscode.window.showInformationMessage(t('toast.diagnosticsCleared'));
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

  statusBarItem.text = t('status.scanning');
  statusBarItem.tooltip = t('status.scanningTooltip', document.fileName);

  const scanner = new Scanner(config);

  try {
    const diagnostics = await scanner.scanDocument(document, cts.token);

    if (cts.token.isCancellationRequested) {
      return;
    }

    diagnosticCollection.set(document.uri, diagnostics);

    if (diagnostics.length > 0) {
      statusBarItem.text = t('status.detected', diagnostics.length);
      if (isManual) {
        vscode.window.showWarningMessage(t('toast.detectedWarning', diagnostics.length));
      }
    } else {
      statusBarItem.text = t('status.clean');
      if (isManual) {
        vscode.window.showInformationMessage(t('toast.cleanInfo'));
      }
    }
  } catch (err: any) {
    if (!cts.token.isCancellationRequested) {
      console.error('Jev Linter scan failed:', err);

      if (err instanceof HttpError) {
        handleHttpError(err, isManual);
      } else {
        statusBarItem.text = t('status.error');
        statusBarItem.tooltip = t('toast.scanError', err.message || err);
        if (isManual) {
          vscode.window.showErrorMessage(t('toast.scanError', err.message || err));
        }
      }
    }
  } finally {
    if (activeScanCancellations.get(uriStr) === cts) {
      activeScanCancellations.delete(uriStr);
      // 数秒後にステータスバーを通常表示に戻す
      setTimeout(() => {
        statusBarItem.text = '$(shield) Jev';
        statusBarItem.tooltip = 'Jev Security Linter';
      }, 5000);
    }
    cts.dispose();
  }
}

function handleHttpError(err: HttpError, isManual: boolean) {
  statusBarItem.text = t('status.httpError', err.statusCode);
  statusBarItem.tooltip = `Jev Linter HTTP ${err.statusCode}: ${err.message}`;

  let friendlyMessage = t('toast.httpGeneral', err.statusCode, err.statusText);
  if (err.statusCode === 401) {
    friendlyMessage = t('toast.http401');
  } else if (err.statusCode === 402) {
    friendlyMessage = t('toast.http402');
  } else if (err.statusCode === 429) {
    friendlyMessage = t('toast.http429');
  } else if (err.statusCode === 400) {
    friendlyMessage = t('toast.http400', err.responseBody || 'Invalid request format');
  } else if (err.statusCode >= 500) {
    friendlyMessage = t('toast.http5xx', err.statusCode, err.statusText);
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
