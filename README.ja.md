# Jev Security Linter for Visual Studio Code

[English](README.md) | **日本語**

OpenRouter 上で提供される判断特化型AIモデル（**`typesafe/jev-1.13`** 等）を活用し、ソースコードの保存時（または手動実行時）に潜在的な脆弱性やセキュリティリスクをミリ秒単位で検知し、該当行の下に波線（Squiggly lines）を表示するスタンドアロンな VS Code 拡張機能です。

---

## 主な特徴

- ⚡ **超高速・極小コスト**: 一般的な文章生成LLM（GPT-4o, Claude 等）ではなく、確率と判定のみを返す判断モデル（Jev）を採用。1回約 **0.5秒**・**$0.0001 未満（約0.01円）** でのリアルタイムスキャンを実現。
- 🔌 **MCP不要の完全スタンドアロン**: 外部MCPサーバーを常駐させる必要がなく、OpenRouter REST API（`/api/v1/systemone`）を直接呼び出します。
- 🔍 **純粋二分探索（Divide & Conquer）**: コードを再帰的に分割し、安全な領域を高速に枝刈り（Pruning）しながら `minimumBlockSize`（単一行）までピンポイント特定。
- 🛡️ **二重のセキュリティ保護 & 視覚的区別**:
  - **黄色波線（Warning）**: AI（Jev）によって検知された脆弱性・セキュリティリスク。
  - **赤色波線（Error）**: 単一の行が長大すぎてAIコンテキスト上限を超過した場合（行末への悪意あるコード隠蔽リスクがあるため、切り詰めを行わず手動確認を促すエラーとして表示）。
- 🌐 **多言語対応 (i18n)**: デフォルト言語は英語、VS Code の表示言語が日本語の場合は自動的に日本語表示。
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

### 手動スキャン
- コマンドパレット（`Ctrl + Shift + P` / `Cmd + Shift + P`）を開き、`Jev: 現在のファイルをスキャン`（`Jev: Scan Current File`）を実行。
- または、右下のステータスバーにある `$(shield) Jev` をクリック。

### 診断結果のクリア
- コマンドパレットから `Jev: 診断結果をクリア`（`Jev: Clear Diagnostics`）を実行。

---

## 設定項目 (`settings.json`)

| 設定項目 | デフォルト値 | 説明 |
|---|---|---|
| `jevLinter.apiKey` | `""` | OpenRouter API キー (`sk-or-v1-...`) |
| `jevLinter.apiEndpoint` | `"https://openrouter.ai/api/v1/systemone"` | API エンドポイント (`/systemone` または `/decisions`) |
| `jevLinter.model` | `"~typesafe/jev-latest"` | 使用する判定AIモデル |
| `jevLinter.threshold` | `0.65` | 警告を出す確信度閾値 (0.0 〜 1.0) |
| `jevLinter.searchStrategy` | `"binarySearch"` | 探索アルゴリズム (`binarySearch`: 二分探索法, `slidingWindow`: 固定ウィンドウ) |
| `jevLinter.minimumBlockSize` | `4` | 二分探索法で分割を停止する最小行数（1〜20行で調整可能） |
| `jevLinter.overlapRatio` | `0.15` | 二分探索時の境界オーバーラップ割合（0.0 〜 0.4） |
| `jevLinter.maxChunkChars` | `60000` | 1回のリクエストの最大文字数（超過時はAPIを呼ばずに二分割） |
| `jevLinter.windowLines` | `30` | 1回の判定でスキャンする行数（スライディングウィンドウ時） |
| `jevLinter.overlapLines` | `10` | ウィンドウ間の重複行数（スライディングウィンドウ時） |
| `jevLinter.concurrency` | `4` | APIの並行リクエスト数 |
| `jevLinter.scanOnSave` | `true` | ファイル保存時に自動でスキャンを実行するかどうか |
| `jevLinter.supportedLanguages` | `["javascript", "typescript", ...]` | 自動スキャン対象の言語IDリスト |

---

## VSIX パッケージの作成（配布用）

ローカル環境や社内環境にインストールするための `.vsix` パッケージを作成する場合：

```bash
npm run package
```

生成された `.vsix` ファイルを、VS Code の拡張機能メニュー（`...`）から「VSIX からのインストール」を選択してインストールできます。
