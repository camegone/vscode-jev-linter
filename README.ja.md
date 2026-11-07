# Jev Security Linter for Visual Studio Code

[English](README.md) | **日本語**

OpenRouter 上で提供される判断特化型AIモデル（**`typesafe/jev-1.13`** 等）を活用し、ソースコードの保存時（または手動実行時）に潜在的な脆弱性やセキュリティリスクをミリ秒単位で検知し、該当行の下に波線（Squiggly lines）を表示するスタンドアロンな VS Code 拡張機能です。

---

## 主な特徴

- ⚡ **超高速・極小コスト**: 一般的な文章生成LLM（GPT-4o, Claude 等）ではなく、確率と判定のみを返す判断モデル（Jev）を採用。1回約 **0.5秒**・**$0.0001 未満（約0.01円）** でのリアルタイムスキャンを実現。
- 🔌 **MCP不要の完全スタンドアロン**: 外部MCPサーバーを常駐させる必要がなく、OpenRouter REST API（`/api/v1/systemone`）を直接呼び出します。
- ⚡ **インテリジェント・ブロックキャッシュ**: 評価済みコードブロック（行番号を除いた生コードのSHA-256）をメモリ内LRUキャッシュで保持。ファイルの再保存や部分編集時に変更のないブロックのAPI問い合わせをスキップし、APIコストとレイテンシを極小化。
- 🔍 **マルチブランチ N分木探索**: 1回のリクエストで `maxBranchCount`（デフォルト: 8）個のブロック区間を一括評価。1往復の通信で多数の区間を並列判定し、極小レイテンシでピンポイント特定。
- 🛡️ **二重のセキュリティ保護 & 視覚的区別**:
  - **黄色波線（Warning）**: AI（Jev）によって検知された脆弱性・セキュリティリスク。
  - **赤色波線（Error）**: 単一の行が長大すぎてAIコンテキスト上限を超過した場合（行末への悪意あるコード隠蔽リスクがあるため、切り詰めを行わず手動確認を促すエラーとして表示）。
- 🌐 **VS Code標準の多言語対応（l10n）**: VS Code公式の `l10n` 機構（`l10n/bundle.l10n.*.json` および `package.nls.*.json`）を採用。デフォルトは英語、日本語同梱で、JSONファイルを追加するだけでどの言語にも簡単に対応可能。
- ⚙️ **柔軟なカスタマイズ**: 確信度閾値、二分探索ブロックサイズ、オーバーラップ割合、自動スキャン対象言語を VS Code の設定から調整可能。

---

## インストールと利用準備

### 1. 依存関係のインストールとビルド

```bash
npm install
npm run compile
```

### 2. デバッグ起動（拡張機能のテスト）

1. VS Code で本フォルダを開きます。
2. `F5` キーを押して「Extension Development Host」ウィンドウを起動します。

### 3. OpenRouter API キーの設定

1. [OpenRouter](https://openrouter.ai/) で API キーを発行します。
2. VS Code の設定（`Ctrl + ,` / `Cmd + ,`）を開き、`jevLinter.apiKey` を検索します。
3. 発行した API キー（`sk-or-v1-...`）を入力します（環境変数 `OPENROUTER_API_KEY` からも自動読み取り可能）。

---

## 使い方

### 自動スキャン（保存時）
対応言語のファイルを編集して保存（`Ctrl + S` / `Cmd + S`）すると、自動的にスキャンが実行され、脆弱性のある行に警告（黄色い波線）が表示されます。

### 手動スキャン & 一括監査
- **現在のファイルをスキャン**: コマンドパレット（`Ctrl + Shift + P` / `Cmd + Shift + P`）から `Jev: 現在のファイルをスキャン`（またはステータスバーの `$(shield) Jev` をクリック）。
- **ワークスペース全体をスキャン**: コマンドパレットから `Jev: ワークスペース全体をスキャン` を実行（プログレスバー付きでプロジェクト全体を巡回スキャン）。
- **現在のフォルダ内をスキャン**: コマンドパレットから `Jev: 現在のフォルダ内をスキャン` を実行（開いているファイルと同じディレクトリ内のみを検査）。

### 診断結果・キャッシュのクリア
- コマンドパレットから `Jev: 診断結果をクリア`（`Jev: Clear Diagnostics`）を実行すると、表示中の波線が消去されます。
- コマンドパレットから `Jev: 判定キャッシュをクリア`（`Jev: Clear Decision Cache`）を実行すると、メモリ内の判定キャッシュがフラッシュされます。

---

## ⚡ 分割数（maxBranchCount）と速度・コストのトレードオフ

本拡張機能は、1回のリクエストで複数区間（`maxBranchCount` 個）を一括評価するマルチブランチN分木探索を行います。この分割数設定には **スキャン速度（API往復回数）** と **トークン消費量（APIコスト）** の明確なトレードオフ関係があります。

| 設定値 (`maxBranchCount`) | 木の深さ（往復回数） | 1リクエストの質問数 | 検出速度（体感レイテンシ） | 入力トークン消費（コスト） |
|---|---|---|---|---|
| **大きくする** (例: 16 〜 64) | 非常に浅い（1〜2往復） | 多い（最大64個） | ⚡ **非常に高速** | 📈 **高くなりやすい** |
| **小さくする** (例: 2 〜 4) | 深い（往復回数が多い） | 少ない（2〜4個） | ⏳ **遅い** | 📉 **低く抑えられる** |

### トークン課金と動作の仕組み
OpenRouterの決定モデル（System One / Decisions API）では、1回のリクエストに複数の質問（ブランチ）を含めた場合、**「対象コードのトークン数 × 質問数」** が合算されて入力トークンとして計上・課金されます。
- **分割数を増やす（例: 64分木）**:
  わずか1〜2回の通信でピンポイントに対象行を絞り込めるため待ち時間は劇的に短縮されます。ただし、安全な領域も含めて初手から多数のブランチを同時評価するため、1手あたりの入力トークン数が跳ね上がります（例: 約8,000トークンのコードで64分割すると、1回のリクエストで約50万トークン消費）。
- **分割数を減らす（例: 2〜4分木）**:
  脆弱性を含む領域だけを選択的に深掘りし、安全な領域は早期に枝刈りするため無駄なトークン消費を抑えられます。ただし、絞り込み完了までに必要なAPI往復回数が増加します。

### おすすめの設定目安
- **日常の開発（保存時自動スキャン）**: `maxBranchCount: 4` 〜 `8`（デフォルトの `8` はコストと応答速度のバランスに優れています）
- **CI/CD環境や手動で一気に即座判定したい場合**: `maxBranchCount: 16` 〜 `32`

---

## 🎯 マルチカテゴリー検査 & カスタムルール設定

セキュリティ脆弱性の検査にとどまらず、スペルミス、規約違反、不要コード、レガシー記法など、複数カテゴリーの検査を同時に実行できます。

OpenRouter の System One API（マルチクエスチョン機能）により、**複数のカテゴリを同時に有効化しても 1 回の通信リクエストで並列判定**されるため、往復回数や余計な通信遅延は発生しません。

### 標準搭載の7大プリセットカテゴリー

| カテゴリID | 表示名 | 初期状態 | 初期重要度 | 検査対象の概要 |
|:---|:---|:---:|:---:|:---|
| **`security`** | **セキュリティ脆弱性** | **有効** | `Warning` (黄色波線) | SQLi、コマンド実行、XSS、APIキー/パスワード漏洩、危険な実行 |
| **`typo`** | **スペルミス・誤字脱字** | 無効 | `Information` (青色波線) | コメント、文字列、エラー文、識別子内の明確なスペルミスや誤字脱字 |
| **`policy`** | **規約・ポリシー違反** | 無効 | `Warning` (黄色波線) | 消し忘れのデバッグ文（`console.log`等）、空の例外握りつぶし、固定URL |
| **`redundancy`** | **冗長な記述・デッドコード** | 無効 | `Information` (青色波線) | 到達不能コード、無意味な変数代入、過度に複雑な条件式、車輪の再発明 |
| **`legacy`** | **時代遅れの記法・非推奨API** | 無効 | `Information` (青色波線) | 非推奨APIの使用、旧式構文（`var`、コールバック地獄など） |
| **`performance`** | **性能低下・リソースリーク** | 無効 | `Warning` (黄色波線) | ループ内クエリ（N+1問題）、ファイル/DB接続のクローズ漏れ、無駄な大量生成 |
| **`robustness`** | **例外・境界値ガード不足** | 無効 | `Warning` (黄色波線) | Null/Undefinedの未チェック参照、I/O処理の例外処理抜け、0除算 |

### ルールのカスタマイズと独自ルールの追加 (`settings.json`)

VS Code の `settings.json` の `jevLinter.rules` 配列を編集することで、プリセットの ON/OFF、重要度（Severity）の変更、および**プロジェクト固有のカスタムルールを自由に追加**できます：

```jsonc
{
  "jevLinter.rules": [
    // 1. デフォルトのセキュリティ検査は有効を維持
    {
      "id": "security",
      "name": "セキュリティ脆弱性",
      "enabled": true,
      "severity": "Warning",
      "target": "security vulnerabilities, command injections, SQL injections, hardcoded credentials, unsanitized executions",
      "message": "Jev [Security]: セキュリティ脆弱性の可能性があります"
    },
    // 2. スペルミス・誤字脱字検査を青波線 (Information) で有効化
    {
      "id": "typo",
      "name": "スペルミス・誤字脱字",
      "enabled": true,
      "severity": "Information",
      "target": "spelling mistakes, obvious typos in comments, string literals, error messages, or identifiers",
      "message": "Jev [Typo]: スペルミス・誤字脱字の可能性があります"
    },
    // 3. デバッグ文残存や規約違反の検査を有効化
    {
      "id": "policy",
      "name": "規約・ポリシー違反",
      "enabled": true,
      "severity": "Warning",
      "target": "policy violations, leftover debug prints/console.log, empty catch blocks swallowing errors, hardcoded environment URLs",
      "message": "Jev [Policy]: 規約違反またはデバッグコード残存の可能性があります"
    },
    // 4. 自社・プロジェクト固有の独自カスタムルールを追加！
    {
      "id": "internal-standards",
      "name": "社内コーディング規約",
      "enabled": true,
      "severity": "Warning",
      "target": "usage of forbidden Axios library (native fetch must be used), direct localStorage access, or synchronous file operations",
      "message": "Jev [社内規約]: 禁止ライブラリ(Axios)や同期I/Oが使用されています"
    }
  ]
}
```

#### ルールの設定プロパティ

- **`id`** *(文字列, 必須)*: ルールを一意に識別するキー。
- **`name`** *(文字列, 必須)*: 問題一覧（Problems パネル）や波線ホバー時のソース名（例: `Jev (スペルミス・誤字脱字)`）として表示されます。
- **`enabled`** *(真偽値, デフォルト: true)*: このルールによる検査の有効 / 無効。
- **`severity`** *(文字列, デフォルト: "Warning")*: エディタ上の波線の種類：
  - `"Error"`: 赤色波線（エラー）
  - `"Warning"`: 黄色波線（警告）
  - `"Information"`: 青色波線（情報）
  - `"Hint"`: 薄い下線（ヒント）
- **`target`** *(文字列, 必須)*: Jev モデルに渡す「検査対象・違反とみなすパターン」の英語説明文。具体的かつ明確に書くことでモデルの判定精度が向上します。
- **`message`** *(文字列, 必須)*: エディタで波線にカーソルを合わせた際に表示されるメッセージの接頭辞。

---

## 設定項目 (`settings.json`)

| 設定項目 | デフォルト値 | 説明 |
|---|---|---|
| `jevLinter.apiKey` | `""` | OpenRouter API キー (`sk-or-v1-...`) |
| `jevLinter.apiEndpoint` | `"https://openrouter.ai/api/v1/systemone"` | API エンドポイント (`/systemone` または `/decisions`) |
| `jevLinter.model` | `"~typesafe/jev-latest"` | 使用する判定AIモデル |
| `jevLinter.threshold` | `0.65` | 警告を出す確信度閾値 (0.0 〜 1.0) |
| `jevLinter.maxBranchCount` | `8` | 1回のリクエストで分割・並列評価するブロック数 / 質問数 (2 〜 64)。増やすと高速化・コスト増、減らすと低コスト・低速化 |
| `jevLinter.minimumBlockSize` | `1` | 探索で分割を停止する最小行数（1〜20行で調整可能） |
| `jevLinter.overlapRatio` | `0.15` | 二分探索時の境界オーバーラップ割合（0.0 〜 0.4） |
| `jevLinter.maxChunkChars` | `60000` | 1回のリクエストの最大文字数（超過時はAPIを呼ばずに二分割） |
| `jevLinter.concurrency` | `4` | APIの並行リクエスト数 |
| `jevLinter.scanOnSave` | `true` | ファイル保存時に自動でスキャンを実行するかどうか |
| `jevLinter.warnUnresolvedBlocks` | `false` | 有効時、特定行に絞り込めなかった親ブロック全体に対しても警告を発行する（複数行にまたがる依存関係の検出用） |
| `jevLinter.enableCache` | `true` | コードブロックの判定結果をメモリ内LRUキャッシュに保持し、保存時の重複APIリクエストをスキップする |
| `jevLinter.cacheMaxEntries` | `2000` | メモリ内に保持するコードブロック判定キャッシュの最大件数（100 〜 20000） |
| `jevLinter.supportedLanguages` | `["javascript", "typescript", ...]` | 自動スキャン対象の言語IDリスト |
| `jevLinter.includePattern` | `""` | 一括スキャン対象に含めるファイルパスの正規表現（空の場合はすべてのサポート言語ファイルが対象） |
| `jevLinter.excludePattern` | `"node_modules\|\\.git\|dist\|out\|build\|vendor"` | スキャンから除外するファイルパスの正規表現 |
| `jevLinter.useGitignore` | `true` | スキャン対象収集時に `.gitignore` の除外ルールを適用するかどうか |
| `jevLinter.rules` | `[...]` | 検査ルール・カテゴリー設定（セキュリティ、スペルミス、規約違反、冗長コード、レガシー記法等）と独自カスタム指示 |

---

## VSIX パッケージの作成（配布用）

ローカル環境や社内環境にインストールするための `.vsix` パッケージを作成する場合：

```bash
npm run package
```

生成された `.vsix` ファイルを、VS Code の拡張機能メニュー（`...`）から「VSIX からのインストール」を選択してインストールできます。
