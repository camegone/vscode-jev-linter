# Jev Security Linter for Visual Studio Code

**English** | [日本語](README.ja.md)

A standalone VS Code extension that leverages decision-specialized AI models on OpenRouter (such as **`typesafe/jev-1.13`**) to detect potential code vulnerabilities and security risks in milliseconds, displaying squiggly lines directly under offending lines upon saving (or manual invocation).

---

## Key Features

- ⚡ **Ultra-Fast & Near-Zero Cost**: Powered by TypeSafe Jev (a System One decision model returning typed probabilities rather than heavy generative LLM prose). Achieves real-time scans in ~**0.5 seconds** at less than **$0.0001 per scan**.
- 🔌 **Standalone & MCP-Free**: Direct integration with OpenRouter REST API (`/api/v1/systemone`) without requiring any external MCP servers or sidecar processes.
- ⚡ **Intelligent Block Caching**: In-memory LRU cache based on SHA-256 hashing of pure block content. Skips redundant API calls for unchanged code blocks upon re-saving or partial edits, virtually eliminating latency and cost for repetitive saves.
- 🔍 **Multi-Branch N-ary Search**: Subdivides blocks into `maxBranchCount` (default: 8) parallel query ranges evaluated in a single API round-trip, pinpointing vulnerabilities with minimal latency.
- 🛡️ **Dual Security Guardrails & Visual Distinction**:
  - **Yellow Squiggly (Warning)**: Code vulnerabilities detected by Jev AI.
  - **Red Squiggly (Error)**: Single lines exceeding model context limits (`maxChunkChars`), flagged to prevent evasion/context-smuggling attacks rather than being silently truncated.
- 🌐 **Standard VS Code Localization (l10n)**: Built using VS Code's official `l10n` API (`l10n/bundle.l10n.*.json` and `package.nls.*.json`). English by default, Japanese included, and easily extensible to any language with simple JSON translation files.
- ⚙️ **Fully Configurable**: Customizable confidence threshold, binary search block size, overlap ratio, context limits, and language targets.

---

## Getting Started

### 1. Install Dependencies & Compile

```bash
npm install
npm run compile
```

### 2. Launch in Debug Mode (Extension Host)

1. Open this project folder in VS Code.
2. Press `F5` to open the "Extension Development Host" window.

### 3. Configure OpenRouter API Key

1. Obtain an API key from [OpenRouter](https://openrouter.ai/).
2. Open Settings (`Ctrl + ,` / `Cmd + ,`) and search for `jevLinter.apiKey`.
3. Enter your API key (`sk-or-v1-...`). Alternatively, you can set the `OPENROUTER_API_KEY` environment variable.

---

## Usage

### Automatic Scan on Save
Edit and save any file in a supported language (`Ctrl + S` / `Cmd + S`). A real-time scan triggers automatically, highlighting any detected vulnerabilities with squiggly lines.

### Manual & Batch Scans
- **Scan Current File**: Open Command Palette (`Ctrl + Shift + P` / `Cmd + Shift + P`) and execute `Jev: Scan Current File` (or click `$(shield) Jev` in status bar).
- **Scan Workspace**: Execute `Jev: Scan Entire Workspace` to audit all project files with progress tracking.
- **Scan Current Folder**: Execute `Jev: Scan Current Folder` to audit only files inside the directory of the active editor.

### Clear Diagnostics & Cache
- Open Command Palette and run `Jev: Clear Diagnostics` to remove squiggly lines.
- Open Command Palette and run `Jev: Clear Decision Cache` to flush cached block evaluations.

---

## ⚡ Branch Count (`maxBranchCount`) vs Speed & Cost Trade-off

This extension leverages multi-branch N-ary tree search to evaluate multiple code sub-ranges (`maxBranchCount`) within a single API request. Adjusting this value presents a direct trade-off between **scan speed (API round-trips)** and **token usage (API cost)**:

| Setting (`maxBranchCount`) | Tree Depth (Round-trips) | Questions per Request | Scan Speed (Latency) | Input Token Usage (Cost) |
|---|---|---|---|---|
| **Higher** (e.g., 16 - 64) | Very shallow (1-2 round-trips) | Many (up to 64) | ⚡ **Ultra Fast** | 📈 **Higher** |
| **Lower** (e.g., 2 - 4) | Deep (more round-trips) | Few (2-4) | ⏳ **Slower** | 📉 **Lower** |

### How Token Billing Works
On OpenRouter's decision endpoints (System One / Decisions API), batching multiple questions in one request bills input tokens as **`(Code Context Tokens) × (Number of Questions)`**.
- **Higher branch count (e.g., 64 branches)**:
  Pinpoints vulnerable lines in very few API round-trips with minimal latency. However, because it evaluates many branches simultaneously even for safe code regions, it causes large input token spikes on the initial request (e.g., ~8,000 code tokens × 64 questions ≈ 500,000 input tokens).
- **Lower branch count (e.g., 2-4 branches)**:
  Prunes safe branches early, saving significant token consumption. However, reaching the target lines requires more consecutive round-trips.

### Recommended Values
- **Everyday development (Scan on Save)**: `maxBranchCount: 4` to `8` (default `8` provides an optimal balance between responsiveness and token economy).
- **CI/CD or batch manual audits**: `maxBranchCount: 16` to `32` when low latency is the top priority.

---

## Configuration Settings (`settings.json`)

| Setting | Default | Description |
|---|---|---|
| `jevLinter.apiKey` | `""` | OpenRouter API Key (`sk-or-v1-...`) |
| `jevLinter.apiEndpoint` | `"https://openrouter.ai/api/v1/systemone"` | OpenRouter System One API Endpoint |
| `jevLinter.model` | `"~typesafe/jev-latest"` | Decision AI model to use (OpenRouter model slug) |
| `jevLinter.threshold` | `0.65` | Confidence threshold to trigger warnings (0.0 - 1.0) |
| `jevLinter.maxBranchCount` | `8` | Number of branch divisions / parallel questions per request (2 - 64). Higher = faster but more tokens; lower = cheaper but more round-trips |
| `jevLinter.minimumBlockSize` | `1` | Minimum block size in lines to stop branch division (down to 1 line) |
| `jevLinter.overlapRatio` | `0.15` | Boundary overlap ratio for binary search (0.0 - 0.4) |
| `jevLinter.maxChunkChars` | `60000` | Max characters per request. Larger blocks are divided locally without API calls. |
| `jevLinter.concurrency` | `4` | Number of concurrent API requests |
| `jevLinter.scanOnSave` | `true` | Automatically scan file on save |
| `jevLinter.warnUnresolvedBlocks` | `false` | When enabled, issues warnings for entire parent blocks if a security risk was suspected but could not be pinpointed to individual sub-blocks |
| `jevLinter.enableCache` | `true` | Enable in-memory LRU caching of evaluated code blocks to skip redundant API requests upon repeated saves |
| `jevLinter.cacheMaxEntries` | `2000` | Maximum number of code block hash entries to keep in memory (100 - 20000) |
| `jevLinter.supportedLanguages` | `["javascript", "typescript", ...]` | List of language IDs to automatically scan |
| `jevLinter.includePattern` | `""` | Regex pattern of file paths to include for batch scanning (empty matches all supported language files) |
| `jevLinter.excludePattern` | `"node_modules\|\\.git\|dist\|out\|build\|vendor"` | Regex pattern of file paths to exclude from scanning |
| `jevLinter.useGitignore` | `true` | Whether to respect `.gitignore` exclusion rules when collecting files to scan |

---

## Building VSIX Package

To build a standalone `.vsix` package for local or internal distribution:

```bash
npm run package
```

The generated `.vsix` file can be installed via VS Code Extensions view (`...` menu -> **Install from VSIX...**).
