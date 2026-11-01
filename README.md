# Mori Desktop Pet

Mori is a local-first Windows desktop pet and private assistant for Ollama. It provides Chat, Plan, and Sketch modes, persistent conversations, a local knowledge index, confirmed long-term memories, and supervised visible desktop tasks through its built-in Windows executor.

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

The Tauri shell starts the bundled Node service, reuses the installed Ollama instance, and only stops an Ollama process Mori started itself. It creates a transparent always-on-top pet window without opening a browser. Hovering reveals an eight-action radial menu and the compact composer; the menu expands within the current monitor. Chat opens in a separate transparent always-on-top window, and closing chat or the workbench hides only that window. The pet and tray remain available until you select Exit from the tray. Login autostart opens with the workbench hidden. PDF text extraction uses PDF.js directly, and the packaged Node runtime omits optional native add-ons.

The project pins the Rust stable MSVC toolchain in `rust-toolchain.toml`. Windows builds also need Microsoft C++ Build Tools and the Windows SDK.

```powershell
npm run tauri:dev
npm run tauri:build
```

### Windows builds and code signing

Mori's Windows packages are built on GitHub-hosted Windows runners. The workflow runs tests, builds the frontend and bundled local service, and creates MSI, NSIS, and a local developer payload. Local OpenClaw credentials, Ollama models, conversation history, and indexed files are not part of the build. See [BUILDING.md](BUILDING.md) for repository setup, local installation, release signing, and verification steps.

The workflow also provides a portable developer payload. Its per-user installer creates a desktop shortcut and installs the bundled local service without certificate or policy changes. See [BUILDING.md](BUILDING.md#run-mori-locally-with-smart-app-control-enabled) for installation and diagnostics.

Unsigned MSI/NSIS CI artifacts are for build validation only. The portable payload is for local development and does not guarantee policy acceptance on other machines. A release intended for other Windows users still needs a trusted signature on the Mori executable and installer. Signed release automation remains unavailable until the project is accepted by SignPath Foundation and its GitHub signing settings are configured.

### Code signing policy

Planned provider: [SignPath.io](https://signpath.io/) and [SignPath Foundation](https://signpath.org/). Approval and signing have not been completed.

- Authors and committers: [Emin2008cym](https://github.com/Emin2008cym)
- Reviewers: [Emin2008cym](https://github.com/Emin2008cym); contributions from other authors are reviewed before merge.
- Approvers: [Emin2008cym](https://github.com/Emin2008cym)

See the [Privacy Policy](PRIVACY.md). This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. Mori is applying for SignPath Foundation signing; no release is signed until acceptance and per-release approval are complete.

## Mori desktop tasks

Mori no longer connects to or depends on OpenClaw Gateway. On Windows, the local service starts a private worker from the Mori executable. The worker captures the current screen, reads bounded control names and positions through UI Automation, and accepts only validated mouse, keyboard, text, scroll, wait, and finish actions. It has no shell, script, file-system, COM, or application-private-API operation.

Before a task starts, Mori shows the full task for confirmation. It displays progress and provides pause, stop, and takeover controls; detected physical keyboard or mouse input hands control back to you. Enter, delete, and recognized high-impact controls require another approval. Screen contents are untrusted observations and cannot authorize a task. Screenshots stay in memory and are sent to the configured Ollama endpoint for visual reasoning; with the default configuration, that endpoint is `127.0.0.1`. Keep tasks supervised. Mori cannot operate the lock screen or higher-integrity windows. Existing OpenClaw files and Credential Manager entries are left untouched and are not read by this version of Mori.

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
