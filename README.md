# Mori Desktop Pet

Mori is a local-first Windows desktop pet and private assistant for Ollama. It provides Chat, Plan, and Sketch modes, persistent conversations, a local knowledge index, confirmed long-term memories, and an optional OpenClaw desktop handoff.

## Local development

Requirements: Node.js 24, npm, Ollama, and the models you want to use. Mori defaults to `qwen3.5:4b` and `nomic-embed-text:latest` at `http://127.0.0.1:11434`.

```powershell
npm install
$env:MORI_MODEL = 'qwen3.5:4b'
npm run dev
```

Open `http://127.0.0.1:5173`. The local API listens only on `127.0.0.1:4179`. Set `OLLAMA_URL`, `MORI_MODEL`, `MORI_EMBEDDING_MODEL`, and `MORI_DATA_DIR` before starting the app to override defaults. SQLite data is stored under `%APPDATA%\Mori` by default.

Mori recursively scans only directories you explicitly authorize. It excludes system and program folders, AppData, common credential directories, and credential-named files. It indexes document text and local vision descriptions for PNG/JPEG/WebP images. Audio and video files are recorded as metadata only. Browser data must be exported and imported manually; Mori does not read browser passwords, cookies, or application credentials.

Full chat history is stored by conversation ID. Requests explicitly use `num_ctx: 16384`; older turns are summarized and searchable. Long-term facts are saved only after you confirm a suggestion.

## Windows desktop app

The Tauri shell starts the bundled Node service, reuses the installed Ollama instance, and only stops an Ollama process Mori started itself. It creates a transparent always-on-top pet window without opening a browser. Hovering reveals an eight-action radial menu and the compact composer; the menu expands within the current monitor. Chat opens in a separate transparent always-on-top window, and closing chat or the workbench hides only that window. The pet and tray remain available until you select Exit from the tray. Login autostart opens with the workbench hidden. OpenClaw device credentials are read and written through a Rust Credential Manager command hosted by the signed Mori executable; the Node service passes values over a private child-process pipe, not command-line arguments or application files. PDF text extraction uses PDF.js directly, and the packaged Node runtime omits optional native add-ons.

The project pins the Rust stable MSVC toolchain in `rust-toolchain.toml`. Windows builds also need Microsoft C++ Build Tools and the Windows SDK.

```powershell
npm run tauri:dev
npm run tauri:build
```

### Windows builds and code signing

Mori's Windows packages are built on GitHub-hosted Windows runners. The workflow runs tests, builds the frontend and bundled local service, and creates MSI and NSIS artifacts. Local OpenClaw credentials, Ollama models, conversation history, and indexed files are not part of the build. See [BUILDING.md](BUILDING.md) for repository setup, release signing, and verification steps.

Unsigned CI artifacts are for build validation only. A release intended for a Windows device with Smart App Control enabled must have a trusted signature on the Mori executable and installer. Signed release automation remains unavailable until the project is accepted by SignPath Foundation and its GitHub signing settings are configured.

### Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

- Authors and committers: [Emin2008cym](https://github.com/Emin2008cym)
- Reviewers: [Emin2008cym](https://github.com/Emin2008cym); contributions from other authors are reviewed before merge.
- Approvers: [Emin2008cym](https://github.com/Emin2008cym)

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. Mori defaults to local Ollama and loopback OpenClaw services; configuring a remote model or requesting an OpenClaw task can send the information required for that request to the configured service. Build artifacts contain no user knowledge data, conversation history, or OpenClaw credentials. Mori is applying for SignPath Foundation signing; no release is signed until acceptance and per-release approval are complete.

## OpenClaw desktop control

Mori connects to the loopback Gateway with the version-matched WebSocket client. When the user has not supplied a token, the local service asks the OpenClaw CLI for `gateway.auth.token`; if the CLI is not on PATH, it reads only that field from `%USERPROFILE%\.openclaw\openclaw.json` in process memory. The Gateway token is never returned to the UI or written to Mori's data directory. OpenClaw device identity and device-auth tokens are stored in Windows Credential Manager. Before delegation, Mori inspects the registered dedicated `desktop` agent, its effective tool list, confirms `main` cannot access `computer`, and checks that a connected Windows node advertises `screen.snapshot` and `computer.act`.

OpenClaw's Windows CUA provider is experimental. Its desktop node must run in the interactive user session with a working driver, and the dedicated agent must expose only Computer Use with a vision-capable model. Mori displays and asks you to confirm the full task before submission. During execution, it offers pause, stop, and manual takeover. It instructs the agent to stop and ask before sending, submitting, purchasing, deleting, publishing, or making another high-impact change; that is an agent instruction, not a driver-level click gate. Keep execution supervised. If any capability check fails, Mori refuses the task and never falls back to shell, scripts, or private app APIs.

## Verification

```powershell
npm test
npm run build
npm run package:backend
cargo check --target x86_64-pc-windows-msvc
npm run tauri:build
```

## License

Mori is distributed under the MIT License. Third-party components retain their respective licenses.
