import * as vscode from 'vscode';
import { JevClient, BranchQuestion, BranchResult, HttpError } from './jevClient';
import { LinterConfig } from './config';
import { decisionCache } from './cache';

interface VulnerableRange {
  startLine: number;
  endLine: number;
  confidence: number;
  unresolved?: boolean;
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
    if (config.enableCache) {
      decisionCache.setMaxEntries(config.cacheMaxEntries);
    }
  }

  /**
   * 単一ドキュメントをマルチブランチ二分／N分木探索法でスキャンし、Diagnosticの配列を返します。
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
      const scanResult = await this.runMultiBranchSearch(
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

        const lineLoc =
          range.startLine === range.endLine
            ? `L${range.startLine + 1}`
            : `L${range.startLine + 1}-${range.endLine + 1}`;

        const confidencePct = Math.round(range.confidence * 100);
        const message = range.unresolved
          ? vscode.l10n.t(
              'Jev: Potential security risk suspected across {0}, but could not be pinpointed to specific lines (confidence: {1}%)',
              lineLoc,
              confidencePct
            )
          : vscode.l10n.t(
              'Jev: Potential security risk/vulnerability detected at {0} (confidence: {1}%)',
              lineLoc,
              confidencePct
            );

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
        const message = vscode.l10n.t(
          'Jev: This line is too large for AI verification and was skipped ({0} chars). Malicious code might be concealed at the end; please verify manually.',
          over.charCount.toLocaleString()
        );

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
   * マルチブランチ探索（1リクエストで maxBranchCount 個の区間を一括評価）
   * - 文字数が maxChunkChars を超える巨大領域は API を呼ばずにローカルで二分割
   * - 単一行で maxChunkChars を超える場合は赤波線エラーとして記録
   * - 収まっているブロックは maxBranchCount 分割した質問を一括送信し、1往復で判定完了
   */
  private async runMultiBranchSearch(
    document: vscode.TextDocument,
    totalLines: number,
    signal: AbortSignal,
    token?: vscode.CancellationToken
  ): Promise<ScanResult> {
    const minBlock = this.config.minimumBlockSize;
    const threshold = this.config.threshold;
    const concurrency = this.config.concurrency;
    const maxChars = this.config.maxChunkChars;
    const maxBranches = this.config.maxBranchCount;

    const detected: VulnerableRange[] = [];
    const oversizedLines: OversizedLine[] = [];
    let fatalError: Error | null = null;

    // 指定行範囲を行番号付きテキスト（例: "1| const a = 1;"）で取得
    const getRangeContentWithLineNums = (start: number, end: number): string => {
      const lines: string[] = [];
      for (let i = start; i <= end; i++) {
        lines.push(`${i + 1}| ${document.lineAt(i).text}`);
      }
      return lines.join('\n');
    };

    // 指定行範囲の純粋なテキスト（行番号なし・キャッシュキー用）を取得
    const getRangeRawContent = (start: number, end: number): string => {
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

    // 巨大ブロックをローカルで二分割するヘルパー
    const splitBlockTwo = (start: number, end: number) => {
      const count = end - start + 1;
      const mid = Math.floor((start + end) / 2);
      const overlap = Math.floor(count * this.config.overlapRatio);

      const leftStart = start;
      const leftEnd = Math.max(leftStart, Math.min(end - 1, mid + overlap));

      const rightStart = Math.min(end, Math.max(start + 1, mid - overlap + 1));
      const rightEnd = end;

      const children: { start: number; end: number }[] = [];
      if (leftEnd >= leftStart) children.push({ start: leftStart, end: leftEnd });
      if (rightEnd >= rightStart) children.push({ start: rightStart, end: rightEnd });
      return children;
    };

    // 親ブロックを K 個の子ブランチに分割するヘルパー
    const createSubBranches = (start: number, end: number, k: number): BranchQuestion[] => {
      const count = end - start + 1;
      const step = Math.ceil(count / k);
      const branches: BranchQuestion[] = [];

      for (let i = 0; i < k; i++) {
        const baseStart = start + i * step;
        if (baseStart > end) break;
        const baseEnd = Math.min(start + (i + 1) * step - 1, end);
        const subLen = baseEnd - baseStart + 1;
        const overlap = Math.floor(subLen * this.config.overlapRatio);

        const bStart = Math.max(start, baseStart - overlap);
        const bEnd = Math.min(end, baseEnd + overlap);

        branches.push({
          id: `b${i}`,
          startLine: bStart,
          endLine: bEnd
        });
      }

      return branches;
    };

    interface QueueItem {
      start: number;
      end: number;
      parentConfidence?: number;
    }

    // 探索キューの初期化: 最初はファイル全体を1つのブロックとして投入
    const queue: QueueItem[] = [{ start: 0, end: totalLines - 1, parentConfidence: undefined }];
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
            const children = splitBlockTwo(item.start, item.end);
            for (const child of children) {
              queue.push({
                start: child.start,
                end: child.end,
                parentConfidence: item.parentConfidence
              });
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

          // 3. キャッシュチェック（ブロック全体が過去に安全と判定されている場合は即座に枝刈り）
          if (this.config.enableCache && item.parentConfidence === undefined) {
            const rawBlock = getRangeRawContent(item.start, item.end);
            const cachedBlock = decisionCache.get(this.config.model, rawBlock);
            if (cachedBlock && !cachedBlock.vulnerability) {
              // 過去に安全と判定されたブロックなのでAPI問い合わせも分割もスキップ
              continue;
            }
          }

          // 4. コンテキスト内に収まっている場合はモデルへ問い合わせ
          activeWorkers++;

          (async () => {
            try {
              // 親ブロックの行数がすでに minimumBlockSize 以下なら単一判定
              if (count <= minBlock) {
                const rawSnippet = getRangeRawContent(item.start, item.end);

                // キャッシュヒットの確認
                if (this.config.enableCache) {
                  const cached = decisionCache.get(this.config.model, rawSnippet);
                  if (cached) {
                    if (cached.vulnerability && cached.confidence >= threshold) {
                      detected.push({
                        startLine: item.start,
                        endLine: item.end,
                        confidence: cached.confidence,
                        unresolved: false
                      });
                    } else if (item.parentConfidence !== undefined && this.config.warnUnresolvedBlocks) {
                      detected.push({
                        startLine: item.start,
                        endLine: item.end,
                        confidence: item.parentConfidence,
                        unresolved: true
                      });
                    }
                    return;
                  }
                }

                const codeSnippet = getRangeContentWithLineNums(item.start, item.end);
                const branches: BranchQuestion[] = [{ id: 'b0', startLine: item.start, endLine: item.end }];
                const results = await this.client.scoreBranches(
                  codeSnippet,
                  branches,
                  document.fileName,
                  signal,
                  `${item.start + 1}-${item.end + 1}`
                );

                if (results.length > 0) {
                  const res = results[0];
                  if (this.config.enableCache) {
                    decisionCache.set(this.config.model, rawSnippet, {
                      vulnerability: res.vulnerability,
                      confidence: res.confidence
                    });
                  }

                  if (res.vulnerability && res.confidence >= threshold) {
                    detected.push({
                      startLine: item.start,
                      endLine: item.end,
                      confidence: res.confidence,
                      unresolved: false
                    });
                  } else if (item.parentConfidence !== undefined && this.config.warnUnresolvedBlocks) {
                    detected.push({
                      startLine: item.start,
                      endLine: item.end,
                      confidence: item.parentConfidence,
                      unresolved: true
                    });
                  }
                }
              } else {
                // 親ブロックを最大 maxBranches 個の子ブランチに分割
                const k = Math.min(maxBranches, count);
                const branches = createSubBranches(item.start, item.end, k);

                // 各子ブランチのキャッシュを事前チェックして、未解決のブランチのみAPIに送信する
                const branchesToQuery: BranchQuestion[] = [];
                const branchRawMap = new Map<string, string>();
                let hasVulnerableChild = false;

                for (const b of branches) {
                  const subRaw = getRangeRawContent(b.startLine, b.endLine);
                  branchRawMap.set(b.id, subRaw);

                  if (this.config.enableCache) {
                    const cached = decisionCache.get(this.config.model, subRaw);
                    if (cached) {
                      if (cached.vulnerability && cached.confidence >= threshold) {
                        hasVulnerableChild = true;
                        const subLen = b.endLine - b.startLine + 1;
                        if (subLen <= minBlock) {
                          detected.push({
                            startLine: b.startLine,
                            endLine: b.endLine,
                            confidence: cached.confidence,
                            unresolved: false
                          });
                        } else {
                          queue.push({
                            start: b.startLine,
                            end: b.endLine,
                            parentConfidence: cached.confidence
                          });
                        }
                      }
                      // 安全とキャッシュされている場合は問い合わせ不要でスキップ
                      continue;
                    }
                  }

                  branchesToQuery.push(b);
                }

                // キャッシュ未解決のブランチがある場合のみ API 呼び出し
                if (branchesToQuery.length > 0) {
                  const codeSnippet = getRangeContentWithLineNums(item.start, item.end);
                  const results = await this.client.scoreBranches(
                    codeSnippet,
                    branchesToQuery,
                    document.fileName,
                    signal
                  );

                  for (const res of results) {
                    const subRaw = branchRawMap.get(res.id);
                    if (subRaw && this.config.enableCache) {
                      decisionCache.set(this.config.model, subRaw, {
                        vulnerability: res.vulnerability,
                        confidence: res.confidence
                      });
                    }

                    if (res.vulnerability && res.confidence >= threshold) {
                      hasVulnerableChild = true;
                      const subLen = res.endLine - res.startLine + 1;
                      if (subLen <= minBlock) {
                        // minimumBlockSize に達したため確定
                        detected.push({
                          startLine: res.startLine,
                          endLine: res.endLine,
                          confidence: res.confidence,
                          unresolved: false
                        });
                      } else {
                        // さらに絞り込むため次の階層のキューに投入
                        queue.push({
                          start: res.startLine,
                          end: res.endLine,
                          parentConfidence: res.confidence
                        });
                      }
                    }
                  }
                }

                // 子ブロックがすべて安全だった場合、親ブロック全体も「安全」としてキャッシュ
                if (this.config.enableCache && !hasVulnerableChild && item.parentConfidence === undefined) {
                  const parentRaw = getRangeRawContent(item.start, item.end);
                  decisionCache.set(this.config.model, parentRaw, {
                    vulnerability: false,
                    confidence: 0
                  });
                }

                // 子ブロックがすべて閾値未満だったが、親ブロックが疑わしいと判定されていた場合
                if (
                  !hasVulnerableChild &&
                  item.parentConfidence !== undefined &&
                  this.config.warnUnresolvedBlocks
                ) {
                  detected.push({
                    startLine: item.start,
                    endLine: item.end,
                    confidence: item.parentConfidence,
                    unresolved: true
                  });
                }
              }
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

      if (
        next.startLine <= current.endLine + 1 &&
        (current.unresolved ?? false) === (next.unresolved ?? false)
      ) {
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
