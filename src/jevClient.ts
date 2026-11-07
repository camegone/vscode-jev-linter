import { LinterRule, DEFAULT_RULES } from './config';

export interface DecisionResult {
  vulnerability: boolean;
  confidence: number;
}

export interface BranchQuestion {
  id: string;
  startLine: number; // 0-based
  endLine: number;   // 0-based, inclusive
}

export interface RuleEvaluation {
  ruleId: string;
  detected: boolean;
  confidence: number;
}

export interface BranchResult {
  id: string;
  startLine: number;
  endLine: number;
  vulnerability: boolean;
  confidence: number;
  ruleResults: Record<string, RuleEvaluation>;
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly statusText: string,
    public readonly responseBody: string
  ) {
    const preview = responseBody.trim() ? `: ${responseBody.trim().slice(0, 200)}` : '';
    super(`HTTP ${statusCode} (${statusText})${preview}`);
    this.name = 'HttpError';
  }
}

export class JevClient {
  constructor(
    private apiKey: string,
    private model: string = '~typesafe/jev-latest',
    private endpoint: string = 'https://openrouter.ai/api/v1/systemone'
  ) {}

  /**
   * 単一スニペットの判定（scoreBranches の薄いラッパー）
   */
  async scoreSnippet(
    code: string,
    filePath: string = 'code',
    lineRange: string = '',
    signal?: AbortSignal
  ): Promise<DecisionResult> {
    const branches: BranchQuestion[] = [{ id: 'b0', startLine: 0, endLine: 0 }];
    const results = await this.scoreBranches(code, branches, filePath, signal, lineRange);
    if (results.length > 0) {
      return {
        vulnerability: results[0].vulnerability,
        confidence: results[0].confidence
      };
    }
    return { vulnerability: false, confidence: 0 };
  }

  /**
   * 1回のリクエストで複数区間（マルチブランチ）を一括評価
   */
  async scoreBranches(
    codeWithLineNums: string,
    branches: BranchQuestion[],
    filePath: string = 'code',
    signal?: AbortSignal,
    customLineRange?: string,
    rules: LinterRule[] = [DEFAULT_RULES[0]]
  ): Promise<BranchResult[]> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API Key is not configured.');
    }

    if (branches.length === 0 || rules.length === 0) {
      return [];
    }

    // 各ブランチ × 有効ルールに対する noul 質問を構築
    const questions: Record<string, any> = {};
    for (const b of branches) {
      const displayRange = customLineRange || `${b.startLine + 1}-${b.endLine + 1}`;
      for (const rule of rules) {
        const qKey = `${b.id}__${rule.id}`;
        questions[qKey] = {
          type: 'noul',
          instructions: `Target: ${rule.target}\nDo lines ${displayRange} contain ${rule.name} issues?`,
          criteria: {
            true: `Lines ${displayRange} contain ${rule.name} issues`,
            false: `Lines ${displayRange} are safe`
          }
        };
      }
    }

    const payload = {
      model: this.model,
      questions,
      state: {
        path: filePath,
        content: codeWithLineNums
      }
    };

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/camegone/vscode-jev-linter',
        'X-Title': 'Jev VSCode Linter'
      },
      body: JSON.stringify(payload),
      signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new HttpError(res.status, res.statusText, errText);
    }

    const data = (await res.json()) as any;
    const answers = data.answers || {};

    return branches.map((b) => {
      const ruleResults: Record<string, RuleEvaluation> = {};
      let anyDetected = false;
      let maxConfidence = 0;

      for (const rule of rules) {
        const qKey = `${b.id}__${rule.id}`;
        const ans = answers[qKey];
        const prob = ans && typeof ans.noul === 'number' ? ans.noul : 0;
        const isDetected = prob >= 0.5;
        ruleResults[rule.id] = {
          ruleId: rule.id,
          detected: isDetected,
          confidence: prob
        };
        if (isDetected) {
          anyDetected = true;
          maxConfidence = Math.max(maxConfidence, prob);
        }
      }

      return {
        id: b.id,
        startLine: b.startLine,
        endLine: b.endLine,
        vulnerability: anyDetected,
        confidence: maxConfidence,
        ruleResults
      };
    });
  }
}
