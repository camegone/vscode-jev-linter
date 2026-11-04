export interface DecisionResult {
  vulnerability: boolean;
  confidence: number;
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
    private model: string = 'typesafe/jev-1.13',
    private endpoint: string = 'https://openrouter.ai/api/v1/systemone'
  ) {}

  /**
   * コードスニペットを判定
   */
  async scoreSnippet(
    code: string,
    filePath: string = 'code',
    lineRange: string = '',
    signal?: AbortSignal
  ): Promise<DecisionResult> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API Key is not configured.');
    }

    // エンドポイントが chat/completions の場合のみ chat API を呼び出し
    if (this.endpoint.includes('/chat/completions')) {
      return await this.scoreWithChatCompletions(code, signal);
    }

    // デフォルト: System One / Decisions API (/api/v1/systemone または /api/alpha/decisions)
    return await this.scoreWithSystemOneApi(code, filePath, lineRange, signal);
  }

  /**
   * OpenRouter System One API (/api/v1/systemone)
   */
  private async scoreWithSystemOneApi(
    code: string,
    filePath: string,
    lineRange: string,
    signal?: AbortSignal
  ): Promise<DecisionResult> {
    const payload = {
      model: this.model,
      questions: {
        vuln: {
          type: 'noul',
          instructions:
            'Target: security vulnerabilities, command injections, SQL injections, hardcoded credentials, unsanitized executions\nIs a security risk or vulnerability located in this code fragment?',
          criteria: {
            true: 'This fragment contains a vulnerability, security flaw, injection, or hardcoded credential',
            false: 'This fragment is safe or unrelated to vulnerabilities'
          }
        }
      },
      state: {
        path: filePath,
        lines: lineRange,
        content: code
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
    const answer = data.answers?.vuln;
    if (answer) {
      const prob = typeof answer.noul === 'number' ? answer.noul : 0;
      return {
        vulnerability: prob >= 0.5,
        confidence: prob
      };
    }

    return { vulnerability: false, confidence: 0 };
  }

  /**
   * 一般チャットモデル用フォールバック
   */
  private async scoreWithChatCompletions(code: string, signal?: AbortSignal): Promise<DecisionResult> {
    const prompt = `Code snippet:\n\`\`\`\n${code}\n\`\`\`\n\nQuestion: Does this code contain security risks or vulnerabilities (e.g. injection, unsanitized exec, leaks)? Respond in JSON: {"vulnerability": boolean, "confidence": float between 0 and 1}`;

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/camegone/vscode-jev-linter',
        'X-Title': 'Jev VSCode Linter'
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      }),
      signal
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new HttpError(res.status, res.statusText, errBody);
    }

    const data = (await res.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return { vulnerability: false, confidence: 0 };
    }

    try {
      const parsed = JSON.parse(content.trim());
      return {
        vulnerability: Boolean(parsed.vulnerability),
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0
      };
    } catch {
      return { vulnerability: false, confidence: 0 };
    }
  }
}
