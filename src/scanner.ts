import * as vscode from 'vscode';
import { JevClient, BranchQuestion, BranchResult, HttpError } from './jevClient';
import { LinterConfig, LinterRule, DiagnosticSeverityType } from './config';
import { decisionCache } from './cache';

interface DetectedIssueRange {
  startLine: number;
  endLine: number;
  confidence: number;
  rule: LinterRule;
  unresolved?: boolean;
}

interface OversizedLine {
  line: number;
  charCount: number;
}

interface ScanResult {
  detectedIssues: DetectedIssueRange[];
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

      const severityMap: Record<DiagnosticSeverityType, vscode.DiagnosticSeverity> = {
        Error: vscode.DiagnosticSeverity.Error,
        Warning: vscode.DiagnosticSeverity.Warning,
        Information: vscode.DiagnosticSeverity.Information,
        Hint: vscode.DiagnosticSeverity.Hint
      };

      // 1. 各ルールで検出された問題（設定された Severity の波線）
      const mergedRanges = this.mergeRanges(scanResult.detectedIssues);
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
        const baseMsg = range.rule.message;
        const message = range.unresolved
          ? `${baseMsg} across ${lineLoc} (unresolved, ${confidencePct}%)`
          : `${baseMsg} at ${lineLoc} (${confidencePct}%)`;

        const severity = severityMap[range.rule.severity] || vscode.DiagnosticSeverity.Warning;
        const diag = new vscode.Diagnostic(vsRange, message, severity);
        diag.source = `Jev (${range.rule.name})`;
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
    const activeRules = this.config.rules.filter((r) => r.enabled);

    if (activeRules.length === 0) {
      return { detectedIssues: [], oversizedLines: [] };
    }

    const detected: DetectedIssueRange[] = [];
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
      activeRules: LinterRule[];
      parentConfidence?: Record<string, number>;
    }

    // 探索キューの初期化: 最初はファイル全体を全有効ルールで投入
    const queue: QueueItem[] = [
      { start: 0, end: totalLines - 1, activeRules, parentConfidence: undefined }
    ];
    let activeWorkers = 0;

    return new Promise<ScanResult>((resolve, reject) => {
      const pump = () => {
        if (fatalError) {
          reject(fatalError);
          return;
        }

        if (token?.isCancellationRequested || signal.aborted) {
          resolve({ detectedIssues: [], oversizedLines: [] });
          return;
        }

        // キューが空で稼働中ワーカーもなければ探索完了
        if (queue.length === 0 && activeWorkers === 0) {
          resolve({ detectedIssues: detected, oversizedLines });
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
                activeRules: item.activeRules,
                parentConfidence: item.parentConfidence
              });
            }
            continue;
          }

          // 2. 単一行で maxChunkChars を超過している場合:
          if (approxChars > maxChars && count === 1) {
            const lineLen = document.lineAt(item.start).text.length;
            oversizedLines.push({ line: item.start, charCount: lineLen });
            continue;
          }

          // 3. キャッシュチェック（全アクティブルールが過去に安全と判定されている場合は即座に枝刈り）
          let currentRules = item.activeRules;
          if (this.config.enableCache && item.parentConfidence === undefined) {
            const rawBlock = getRangeRawContent(item.start, item.end);
            currentRules = currentRules.filter((r) => {
              const cached = decisionCache.get(this.config.model, r.id, rawBlock);
              return !(cached && !cached.detected);
            });
            if (currentRules.length === 0) {
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
                const rulesToQuery: LinterRule[] = [];

                for (const r of currentRules) {
                  if (this.config.enableCache) {
                    const cached = decisionCache.get(this.config.model, r.id, rawSnippet);
                    if (cached) {
                      if (cached.detected && cached.confidence >= threshold) {
                        detected.push({
                          startLine: item.start,
                          endLine: item.end,
                          confidence: cached.confidence,
                          rule: r,
                          unresolved: false
                        });
                      }
                      continue;
                    }
                  }
                  rulesToQuery.push(r);
                }

                if (rulesToQuery.length > 0) {
                  const codeSnippet = getRangeContentWithLineNums(item.start, item.end);
                  const branches: BranchQuestion[] = [{ id: 'b0', startLine: item.start, endLine: item.end }];
                  const results = await this.client.scoreBranches(
                    codeSnippet,
                    branches,
                    document.fileName,
                    signal,
                    `${item.start + 1}-${item.end + 1}`,
                    rulesToQuery
                  );

                  if (results.length > 0) {
                    const res = results[0];
                    for (const r of rulesToQuery) {
                      const evalRes = res.ruleResults[r.id];
                      if (evalRes) {
                        if (this.config.enableCache) {
                          decisionCache.set(this.config.model, r.id, rawSnippet, {
                            detected: evalRes.detected,
                            confidence: evalRes.confidence
                          });
                        }
                        if (evalRes.detected && evalRes.confidence >= threshold) {
                          detected.push({
                            startLine: item.start,
                            endLine: item.end,
                            confidence: evalRes.confidence,
                            rule: r,
                            unresolved: false
                          });
                        }
                      }
                    }
                  }
                }
              } else {
                // 親ブロックを最大 maxBranches 個の子ブランチに分割
                const k = Math.min(maxBranches, count);
                const branches = createSubBranches(item.start, item.end, k);

                const branchPendingRules = new Map<string, LinterRule[]>();
                const branchSubLen = new Map<string, number>();
                const branchActiveForNext = new Map<string, LinterRule[]>();
                const rulesDetectedAnywhere = new Set<string>();

                for (const b of branches) {
                  const subLen = b.endLine - b.startLine + 1;
                  branchSubLen.set(b.id, subLen);
                  const subRaw = getRangeRawContent(b.startLine, b.endLine);
                  const pendingRules: LinterRule[] = [];
                  const nextRules: LinterRule[] = [];

                  for (const r of currentRules) {
                    if (this.config.enableCache) {
                      const cached = decisionCache.get(this.config.model, r.id, subRaw);
                      if (cached) {
                        if (cached.detected && cached.confidence >= threshold) {
                          rulesDetectedAnywhere.add(r.id);
                          if (subLen <= minBlock) {
                            detected.push({
                              startLine: b.startLine,
                              endLine: b.endLine,
                              confidence: cached.confidence,
                              rule: r,
                              unresolved: false
                            });
                          } else {
                            nextRules.push(r);
                          }
                        }
                        continue;
                      }
                    }
                    pendingRules.push(r);
                  }

                  if (pendingRules.length > 0) {
                    branchPendingRules.set(b.id, pendingRules);
                  }
                  if (nextRules.length > 0) {
                    branchActiveForNext.set(b.id, nextRules);
                  }
                }

                // 未解決のブランチがある場合のみ API 呼び出し
                const branchesToQuery = branches.filter((b) => branchPendingRules.has(b.id));
                if (branchesToQuery.length > 0) {
                  const allRulesToQuery = Array.from(
                    new Set(branchesToQuery.flatMap((b) => branchPendingRules.get(b.id)!))
                  );

                  const codeSnippet = getRangeContentWithLineNums(item.start, item.end);
                  const results = await this.client.scoreBranches(
                    codeSnippet,
                    branchesToQuery,
                    document.fileName,
                    signal,
                    undefined,
                    allRulesToQuery
                  );

                  for (const res of results) {
                    const subLen = branchSubLen.get(res.id) || 1;
                    const b = branches.find((br) => br.id === res.id)!;
                    const subRaw = getRangeRawContent(b.startLine, b.endLine);
                    const nextRules = branchActiveForNext.get(res.id) || [];

                    for (const r of allRulesToQuery) {
                      const evalRes = res.ruleResults[r.id];
                      if (evalRes) {
                        if (this.config.enableCache) {
                          decisionCache.set(this.config.model, r.id, subRaw, {
                            detected: evalRes.detected,
                            confidence: evalRes.confidence
                          });
                        }
                        if (evalRes.detected && evalRes.confidence >= threshold) {
                          rulesDetectedAnywhere.add(r.id);
                          if (subLen <= minBlock) {
                            detected.push({
                              startLine: b.startLine,
                              endLine: b.endLine,
                              confidence: evalRes.confidence,
                              rule: r,
                              unresolved: false
                            });
                          } else {
                            nextRules.push(r);
                          }
                        }
                      }
                    }

                    if (nextRules.length > 0) {
                      branchActiveForNext.set(res.id, nextRules);
                    }
                  }
                }

                // 探索キューに次階層のブランチを投入
                for (const b of branches) {
                  const nextRules = branchActiveForNext.get(b.id);
                  if (nextRules && nextRules.length > 0) {
                    queue.push({
                      start: b.startLine,
                      end: b.endLine,
                      activeRules: nextRules
                    });
                  }
                }

                // 親ブロック全体で、どの子ブランチでも検出されなかったルールは「安全」としてキャッシュ
                if (this.config.enableCache && item.parentConfidence === undefined) {
                  const parentRaw = getRangeRawContent(item.start, item.end);
                  for (const r of currentRules) {
                    if (!rulesDetectedAnywhere.has(r.id)) {
                      decisionCache.set(this.config.model, r.id, parentRaw, {
                        detected: false,
                        confidence: 0
                      });
                    }
                  }
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

        // whileループ内で全アイテムが同期的スキップされ、キューが空かつ稼働ワーカーが0になった場合の解決
        if (queue.length === 0 && activeWorkers === 0) {
          resolve({ detectedIssues: detected, oversizedLines });
          return;
        }
      };

      pump();
    });
  }

  /**
   * 重複・隣接する行範囲を同一ルールごとにマージ
   */
  private mergeRanges(ranges: DetectedIssueRange[]): DetectedIssueRange[] {
    if (ranges.length <= 1) {
      return ranges;
    }

    const byRule = new Map<string, DetectedIssueRange[]>();
    for (const r of ranges) {
      const list = byRule.get(r.rule.id) || [];
      list.push(r);
      byRule.set(r.rule.id, list);
    }

    const mergedAll: DetectedIssueRange[] = [];

    for (const [, list] of byRule) {
      const sorted = [...list].sort((a, b) => a.startLine - b.startLine);
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
          mergedAll.push(current);
          current = { ...next };
        }
      }
      mergedAll.push(current);
    }

    return mergedAll;
  }
}
