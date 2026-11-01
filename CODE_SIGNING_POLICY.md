# Code Signing Policy

## Current status

Mori's source code is published under the MIT License. SignPath Foundation signing has not been approved or configured, and no Mori release is currently signed by SignPath Foundation. Existing unsigned packages are for validation only and may be blocked by Smart App Control (SAC).

Planned provider, subject to acceptance: Free code signing provided by SignPath.io, certificate by SignPath Foundation. Each release will be built from a tagged commit in this public repository and will require manual approval before signing. Signed release assets will include SHA-256 hashes and a link to the source tag.

## Roles

- Authors and committers: [Emin2008cym](https://github.com/Emin2008cym), the repository owner.
- Reviewers: [Emin2008cym](https://github.com/Emin2008cym). Contributions from other authors must be reviewed before merge.
- Signing approver: [Emin2008cym](https://github.com/Emin2008cym). The approver checks the tagged source, build result, and release contents before approving each signing request.

Repository and SignPath accounts must have multi-factor authentication enabled before signing is activated.

## Build and signing controls

- Windows artifacts are built on GitHub-hosted Windows runners from source in this repository.
- The signing workflow accepts only an existing version tag whose commit is already on `main`.
- The release executable and installer files are submitted separately for Authenticode signing, then signature status and SHA-256 hashes are checked before publishing.
- Signing credentials are stored in GitHub or SignPath protected settings. Private keys and API tokens are never committed or included in build artifacts.
- Mori does not modify Windows application-control policy or attempt to bypass SAC. An unsigned or untrusted artifact is not described as SAC-compatible.
- Third-party software and artwork retain their upstream or documented licenses. The maintainer must verify that every bundled asset may be redistributed under the applicable license before requesting a release signature.

## Privacy

See the [Mori Privacy Policy](PRIVACY.md). The release build does not include local conversations, knowledge files, Ollama models, OpenClaw credentials, or machine-specific settings. This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

## Support and corrections

Report signing-policy or release-integrity concerns through [GitHub Issues](https://github.com/Emin2008cym/mori-desktop-pet/issues). Include the release tag and file name; do not post private data, credentials, or signing tokens.
