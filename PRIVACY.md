# Privacy Policy

Last updated: 2026-10-31

Mori is a local-first Windows desktop application. It does not operate a hosted account service and this release does not include product analytics or advertising.

## Information stored on your device

Mori stores conversation messages, conversation titles and summaries, modes, confirmed long-term memories, selected knowledge-folder paths, indexed file metadata, extracted document text, and image descriptions in its local application data directory. Audio and video files are recorded as metadata only. Mori scans only folders you authorize. Browser passwords, cookies, and application credentials are not indexed.

OpenClaw device identity and device-auth credentials are stored in Windows Credential Manager. Mori reads the OpenClaw Gateway token from the local OpenClaw configuration in process memory when needed; Mori does not return that token to the user interface or save it in the Mori database.

## Network connections

By default, Mori connects to Ollama and the OpenClaw Gateway on loopback addresses on your own computer. It does not send your information to the Mori project maintainer.

If you configure a remote model endpoint, Mori sends the prompt and context needed for that request to that endpoint. When you explicitly delegate a desktop task to OpenClaw, Mori sends the task and the screen information needed by the configured Gateway and Agent. The Gateway or Agent may use a model provider configured separately in OpenClaw. Those services' privacy terms and settings apply to information they receive.

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

GitHub Actions builds use the public source repository and public package registries. Build jobs do not access a user's local Mori database, indexed files, Ollama models, or OpenClaw credentials.

## Retention and deletion

Local data remains on your device until you delete it. You can delete conversations and confirmed memories in Mori. To remove all Mori application data, close Mori and delete its Windows application data directory. OpenClaw device credentials are separate from that directory and can be removed from Windows Credential Manager.

## Contact

For privacy questions, contact the project maintainer through the [Mori GitHub repository](https://github.com/Emin2008cym/mori-desktop-pet). Do not post private files, credentials, or other sensitive information in public issues.
