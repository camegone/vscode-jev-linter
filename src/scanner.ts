import * as vscode from 'vscode';
import { JevClient, DecisionResult, HttpError } from './jevClient';
import { LinterConfig } from './config';
import { t } from './i18n';

interface VulnerableRange {
  startLine: number;
  endLine: number;
  confidence: number;
}

interface OversizedLine {
  line: number;
  charCount: number;
}

interface ScanResult {
  vulnerableRanges: VulnerableRange[];
  oversizedLines: OversizedLine[];
}

export class Scanner {
  private client: JevClient;

  constructor(private config: LinterConfig) {
    this.client = new JevClient(config.apiKey, config.model, config.apiEndpoint);
  }

  /**
   * 単一ドキュメントを二分探索法でスキャンし、Diagnosticの配列を返します。
   */
  async scanDocument(
    document: vscode.TextDocument,
    token?: vscode.CancellationToken
  ): Promise<vscode.Diagnostic[]> {
    const totalLines = document.lineCount;
    if (totalLines === 0) {
      return [];
    }

    const abortController = new AbortController();
    const tokenListener = token?.onCancellationRequested(() => {
      abortController.abort();
    });

    try {
      const scanResult = await this.runBinarySearch(
        document,
        totalLines,
        abortController.signal,
        token
      );

      if (token?.isCancellationRequested) {
        return [];
      }

      const diagnostics: vscode.Diagnostic[] = [];

      // 1. 脆弱性が検出された行範囲（Warning: 黄色波線）
      const mergedRanges = this.mergeRanges(scanResult.vulnerableRanges);
      for (const range of mergedRanges) {
        const startPos = new vscode.Position(range.startLine, 0);
        const endLineText = document.lineAt(range.endLine).text;
        const endPos = new vscode.Position(range.endLine, endLineText.length);
        const vsRange = new vscode.Range(startPos, endPos);

        const confidencePct = Math.round(range.confidence * 100);
        const message = t('diag.warning', confidencePct);

        const diag = new vscode.Diagnostic(
          vsRange,
          message,
          vscode.DiagnosticSeverity.Warning
        );
        diag.source = 'Jev Security';
        diagnostics.push(diag);
      }

      // 2. 単一行でコンテキスト上限を超過した長大行（Error: 赤波線）
      // 切り詰めによる隠蔽攻撃の見落としを防ぐため、エラーとして手動確認を促す
      for (const over of scanResult.oversizedLines) {
        const lineText = document.lineAt(over.line).text;
        const vsRange = new vscode.Range(
          new vscode.Position(over.line, 0),
          new vscode.Position(over.line, lineText.length)
        );
        const message = t('diag.oversizedLine', over.charCount.toLocaleString());

        const diag = new vscode.Diagnostic(
          vsRange,
          message,
          vscode.DiagnosticSeverity.Error
        );
        diag.source = 'Jev Security';
        diagnostics.push(diag);
      }

      return diagnostics;
    } finally {
      tokenListener?.dispose();
    }
  }

  /**
   * 二分探索法（Divide & Conquer）による脆弱性箇所の特定
   * - 文字数が maxChunkChars を超える巨大領域は、API を呼ばずにローカルで高速に二分割を繰り返す
   * - 単一行で maxChunkChars を超える場合は、切り捨てによる隠蔽リスク防止のため赤波線エラーとして記録
   * - コンテキスト内に収まった領域からモデル判定を行い、安全な領域は即座に枝刈り、
   *   脆弱性領域は minimumBlockSize まで二分探索を継続してピンポイント特定
   */
  private async runBinarySearch(
    document: vscode.TextDocument,
    totalLines: number,
    signal: AbortSignal,
    token?: vscode.CancellationToken
  ): Promise<ScanResult> {
    const minBlock = this.config.minimumBlockSize;
    const threshold = this.config.threshold;
    const concurrency = this.config.concurrency;
    const maxChars = this.config.maxChunkChars;

    const detected: VulnerableRange[] = [];
    const oversizedLines: OversizedLine[] = [];
    const cache = new Map<string, Promise<DecisionResult>>();
    let fatalError: Error | null = null;

    // 指定行範囲のテキストを取得
    const getRangeContent = (start: number, end: number): string => {
      const lines: string[] = [];
      for (let i = start; i <= end; i++) {
        lines.push(document.lineAt(i).text);
      }
      return lines.join('\n');
    };

    // 指定行範囲の概算文字数を算出
    const getRangeCharCount = (start: number, end: number): number => {
      let chars = 0;
      for (let i = start; i <= end; i++) {
        chars += document.lineAt(i).text.length + 1;
      }
      return chars;
    };

    // ブロックを二分割するヘルパー
    const splitBlock = (start: number, end: number) => {
      const count = end - start + 1;
      const mid = Math.floor((start + end) / 2);
      const overlap = Math.floor(count * this.config.overlapRatio);

      const leftStart = start;
      const leftEnd = Math.max(leftStart, Math.min(end - 1, mid + overlap));

      const rightStart = Math.min(end, Math.max(start + 1, mid - overlap + 1));
      const rightEnd = end;

      const children: { start: number; end: number }[] = [];
      if (leftEnd >= leftStart) {
        children.push({ start: leftStart, end: leftEnd });
      }
      if (rightEnd >= rightStart) {
        children.push({ start: rightStart, end: rightEnd });
      }
      return children;
    };

    // 行キャッシュヘルパー
    const evaluateRange = (start: number, end: number, content: string): Promise<DecisionResult> => {
      const key = `${start}-${end}`;
      if (cache.has(key)) {
        return cache.get(key)!;
      }

      if (content.trim().length === 0) {
        const dummy: DecisionResult = { vulnerability: false, confidence: 0 };
        const p = Promise.resolve(dummy);
        cache.set(key, p);
        return p;
      }

      const lineRange = `${start + 1}-${end + 1}`;
      const promise = this.client.scoreSnippet(content, document.fileName, lineRange, signal);
      cache.set(key, promise);
      return promise;
    };

    // 探索キューの初期化: 最初はファイル全体を1つのブロックとして投入
    const queue: { start: number; end: number }[] = [{ start: 0, end: totalLines - 1 }];
    let activeWorkers = 0;

    return new Promise<ScanResult>((resolve, reject) => {
      const pump = () => {
        if (fatalError) {
          reject(fatalError);
          return;
        }

        if (token?.isCancellationRequested || signal.aborted) {
          resolve({ vulnerableRanges: [], oversizedLines: [] });
          return;
        }

        // キューが空で稼働中ワーカーもなければ探索完了
        if (queue.length === 0 && activeWorkers === 0) {
          resolve({ vulnerableRanges: detected, oversizedLines });
          return;
        }

        // 並行数に達するまでワーカーを起動
        while (queue.length > 0 && activeWorkers < concurrency) {
          const item = queue.shift()!;
          const count = item.end - item.start + 1;
          const approxChars = getRangeCharCount(item.start, item.end);

          // 1. 文字数チェック:
          // 複数行で maxChunkChars を超える巨大領域は、API を呼ばずにローカルで二分割
          if (approxChars > maxChars && count > 1) {
            const children = splitBlock(item.start, item.end);
            for (const child of children) {
              queue.push(child);
            }
            continue;
          }

          // 2. 単一行で maxChunkChars を超過している場合:
          // 切り捨てによる隠蔽リスク防止のため、赤波線エラーとして記録しAPI判定は行わない
          if (approxChars > maxChars && count === 1) {
            const lineLen = document.lineAt(item.start).text.length;
            oversizedLines.push({ line: item.start, charCount: lineLen });
            continue;
          }

          // 3. 文字数がコンテキストに収まっている場合はモデルへ問い合わせ
          activeWorkers++;

          (async () => {
            try {
              const content = getRangeContent(item.start, item.end);
              const res = await evaluateRange(item.start, item.end, content);

              if (res.vulnerability && res.confidence >= threshold) {
                if (count <= minBlock) {
                  // minimumBlockSize に達したため確定
                  detected.push({
                    startLine: item.start,
                    endLine: item.end,
                    confidence: res.confidence
                  });
                } else {
                  // 二分割（二分探索）して子ブロックをキューに追加
                  const children = splitBlock(item.start, item.end);
                  for (const child of children) {
                    queue.push(child);
                  }
                }
              }
              // vulnerability === false の場合は枝刈り（何もしない）
            } catch (err: any) {
              if (!signal.aborted && !token?.isCancellationRequested) {
                if (err instanceof HttpError) {
                  fatalError = err;
                } else if (!fatalError) {
                  fatalError = err instanceof Error ? err : new Error(String(err));
                }
              }
            } finally {
              activeWorkers--;
              pump();
            }
          })();
        }
      };

      pump();
    });
  }

  /**
   * 重複・隣接する行範囲をマージ
   */
  private mergeRanges(ranges: VulnerableRange[]): VulnerableRange[] {
    if (ranges.length <= 1) {
      return ranges;
    }

    const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine);
    const merged: VulnerableRange[] = [];

    let current = { ...sorted[0] };

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];

      if (next.startLine <= current.endLine + 1) {
        current.endLine = Math.max(current.endLine, next.endLine);
        current.confidence = Math.max(current.confidence, next.confidence);
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);

    return merged;
  }
}
