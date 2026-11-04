import * as vscode from 'vscode';
import { getLinterConfig, promptForApiKey } from './config';
import { Scanner } from './scanner';
import { HttpError } from './jevClient';

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
  statusBarItem.tooltip = 'Jev Security Linter: クリックして現在のファイルをスキャン';
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
        vscode.window.showInformationMessage('Jev Linter: 開いているエディタがありません。');
        return;
      }
      await runScan(editor.document, true);
    })
  );

  // コマンド: 診断結果をクリア
  context.subscriptions.push(
    vscode.commands.registerCommand('jevLinter.clearDiagnostics', () => {
      diagnosticCollection.clear();
      vscode.window.showInformationMessage('Jev Linter: すべての診断結果をクリアしました。');
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

  statusBarItem.text = '$(sync~spin) Jev: スキャン中...';
  statusBarItem.tooltip = `Jev Linter: ${document.fileName} をスキャンしています`;

  const scanner = new Scanner(config);

  try {
    const diagnostics = await scanner.scanDocument(document, cts.token);

    if (cts.token.isCancellationRequested) {
      return;
    }

    diagnosticCollection.set(document.uri, diagnostics);

    if (diagnostics.length > 0) {
      statusBarItem.text = `$(alert) Jev: 脆弱性検出 (${diagnostics.length}件)`;
      if (isManual) {
        vscode.window.showWarningMessage(
          `Jev Linter: ${diagnostics.length} 箇所のセキュリティリスクを検出しました。`
        );
      }
    } else {
      statusBarItem.text = '$(check) Jev: 問題なし';
      if (isManual) {
        vscode.window.showInformationMessage('Jev Linter: セキュリティ脆弱性は検出されませんでした。');
      }
    }
  } catch (err: any) {
    if (!cts.token.isCancellationRequested) {
      console.error('Jev Linter scan failed:', err);

      if (err instanceof HttpError) {
        handleHttpError(err, isManual);
      } else {
        statusBarItem.text = '$(error) Jev: エラー';
        statusBarItem.tooltip = `Jev Linter エラー: ${err.message || err}`;
        if (isManual) {
          vscode.window.showErrorMessage(`Jev Linter スキャンエラー: ${err.message || err}`);
        }
      }
    }
  } finally {
    if (activeScanCancellations.get(uriStr) === cts) {
      activeScanCancellations.delete(uriStr);
      // 数秒後にステータスバーを通常表示に戻す
      setTimeout(() => {
        statusBarItem.text = '$(shield) Jev';
        statusBarItem.tooltip = 'Jev Security Linter: クリックして現在のファイルをスキャン';
      }, 5000);
    }
    cts.dispose();
  }
}

function handleHttpError(err: HttpError, isManual: boolean) {
  statusBarItem.text = `$(error) Jev: HTTP ${err.statusCode}`;
  statusBarItem.tooltip = `Jev Linter HTTP エラー: ${err.message}`;

  let friendlyMessage = `Jev Linter: HTTP ${err.statusCode} (${err.statusText})`;
  if (err.statusCode === 401) {
    friendlyMessage = `Jev Linter: HTTP 401 (Unauthorized) - APIキーが無効か、権限がありません。設定を確認してください。`;
  } else if (err.statusCode === 402) {
    friendlyMessage = `Jev Linter: HTTP 402 (Payment Required) - OpenRouter のクレジット残高が不足しています。`;
  } else if (err.statusCode === 429) {
    friendlyMessage = `Jev Linter: HTTP 429 (Too Many Requests) - レート制限に達しました。しばらく待ってから再試行してください。`;
  } else if (err.statusCode === 400) {
    friendlyMessage = `Jev Linter: HTTP 400 (Bad Request) - ${err.responseBody || 'リクエスト形式が不正です'}`;
  } else if (err.statusCode >= 500) {
    friendlyMessage = `Jev Linter: HTTP ${err.statusCode} (${err.statusText}) - OpenRouter 側でサーバーエラーが発生しました。`;
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
