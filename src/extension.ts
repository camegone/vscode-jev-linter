import * as vscode from 'vscode';
import * as path from 'path';
import { getLinterConfig, promptForApiKey } from './config';
import { Scanner } from './scanner';
import { HttpError } from './jevClient';
import { decisionCache } from './cache';
import { collectFilesToScan } from './fileCollector';

let diagnosticCollection: vscode.DiagnosticCollection;
let statusBarItem: vscode.StatusBarItem;
const activeScanCancellations = new Map<string, vscode.CancellationTokenSource>();

let lastErrorToastTime = 0;
let lastErrorCode: number | null = null;

export async function activate(context: vscode.ExtensionContext) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('jev-security');
  context.subscriptions.push(diagnosticCollection);

  // キャッシュの初期化（ディスク永続化の読み込み）
  await decisionCache.initialize(context, getLinterConfig());

  // 設定変更時のリスナー
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('jevLinter.cacheLocation')) {
        const config = getLinterConfig();
        await decisionCache.configureLocation(config.cacheLocation);
      }
      if (e.affectsConfiguration('jevLinter.cacheMaxEntries')) {
        const config = getLinterConfig();
        decisionCache.setMaxEntries(config.cacheMaxEntries);
      }
    })
  );

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
    vscode.commands.registerCommand('jevLinter.clearCache', async () => {
      const count = await decisionCache.clear();
      vscode.window.showInformationMessage(
        vscode.l10n.t('Jev Linter: Cache cleared ({0} entries removed).', count)
      );
    })
  );

  // コマンド: ワークスペース全体をスキャン
  context.subscriptions.push(
    vscode.commands.registerCommand('jevLinter.scanWorkspace', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showInformationMessage(
          vscode.l10n.t('Jev Linter: No workspace folder open.')
        );
        return;
      }
      for (const folder of workspaceFolders) {
        await runBatchScan(
          folder.uri.fsPath,
          vscode.l10n.t('Jev: Scanning workspace ({0})...', folder.name)
        );
      }
    })
  );

  // コマンド: 現在開いているファイルのフォルダ内をスキャン
  context.subscriptions.push(
    vscode.commands.registerCommand('jevLinter.scanCurrentFolder', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage(
          vscode.l10n.t('Jev Linter: No active editor opened.')
        );
        return;
      }
      const dirPath = path.dirname(editor.document.uri.fsPath);
      const folderName = path.basename(dirPath);
      await runBatchScan(
        dirPath,
        vscode.l10n.t('Jev: Scanning folder ({0})...', folderName)
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

export async function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.clear();
  }
  for (const cts of activeScanCancellations.values()) {
    cts.cancel();
    cts.dispose();
  }
  activeScanCancellations.clear();
  await decisionCache.saveNow();
}

async function runBatchScan(targetDir: string, progressTitle: string) {
  const config = getLinterConfig();

  // APIキー未設定のチェック
  if (!config.apiKey) {
    await promptForApiKey();
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: progressTitle,
      cancellable: true
    },
    async (progress, token) => {
      progress.report({ message: vscode.l10n.t('Collecting files to scan...') });

      const files = await collectFilesToScan(targetDir, config, token);

      if (token.isCancellationRequested) {
        return;
      }

      if (files.length === 0) {
        vscode.window.showInformationMessage(
          vscode.l10n.t('Jev Linter: No target files found to scan in {0}.', targetDir)
        );
        return;
      }

      const scanner = new Scanner(config);
      let scannedCount = 0;
      let vulnerableFilesCount = 0;
      let totalRisks = 0;

      statusBarItem.text = vscode.l10n.t('$(sync~spin) Jev: (0/{0})', files.length);

      for (let i = 0; i < files.length; i++) {
        if (token.isCancellationRequested) {
          break;
        }

        const filePath = files[i];
        const relPath = path.relative(targetDir, filePath);
        progress.report({
          message: `(${i + 1}/${files.length}) ${relPath}`,
          increment: 100 / files.length
        });

        statusBarItem.text = vscode.l10n.t(
          '$(sync~spin) Jev: ({0}/{1})',
          i + 1,
          files.length
        );

        try {
          const uri = vscode.Uri.file(filePath);
          const document = await vscode.workspace.openTextDocument(uri);
          const diagnostics = await scanner.scanDocument(document, token);

          if (token.isCancellationRequested) {
            break;
          }

          diagnosticCollection.set(uri, diagnostics);
          scannedCount++;

          if (diagnostics.length > 0) {
            vulnerableFilesCount++;
            totalRisks += diagnostics.length;
          }
        } catch (err: any) {
          console.error(`Jev Linter batch scan error on ${filePath}:`, err);
          if (err instanceof HttpError) {
            handleHttpError(err, true);
            break;
          }
        }
      }

      if (token.isCancellationRequested) {
        vscode.window.showWarningMessage(
          vscode.l10n.t(
            'Jev Linter: Scan cancelled ({0}/{1} files completed).',
            scannedCount,
            files.length
          )
        );
        statusBarItem.text = '$(shield) Jev';
        return;
      }

      if (totalRisks > 0) {
        statusBarItem.text = vscode.l10n.t(
          '$(alert) Jev: Vulnerability detected ({0})',
          totalRisks
        );
        vscode.window.showWarningMessage(
          vscode.l10n.t(
            'Jev Linter: Scan complete. Found {0} security risk(s) across {1} file(s) ({2} scanned).',
            totalRisks,
            vulnerableFilesCount,
            scannedCount
          )
        );
      } else {
        statusBarItem.text = vscode.l10n.t('$(check) Jev: Clean');
        vscode.window.showInformationMessage(
          vscode.l10n.t(
            'Jev Linter: Scan complete. All {0} file(s) are clean.',
            scannedCount
          )
        );
      }

      setTimeout(() => {
        statusBarItem.text = '$(shield) Jev';
      }, 5000);
    }
  );
}
