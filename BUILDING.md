# Cloud build and release setup

## Prepare the public repository

This checkout has no Git history yet. Before publishing it, review the staged file list and confirm it contains only Mori source, assets, and lock files. The local Application Control report, generated `src-tauri/resources`, Rust build output, dependency folders, local settings, and private data are excluded by `.gitignore`.

Create a public GitHub repository for Mori, then push this source tree. Do not add personal knowledge files, OpenClaw configuration, credentials, or build caches. Public Windows GitHub-hosted runners are the isolated build environment; no Windows Pro upgrade or local SAC change is needed.

## Run an unsigned validation build

1. Open the Mori repository on GitHub and select **Actions**.
2. Select **Windows build** in the workflow list.
3. Select **Run workflow**, choose the branch, and select **Run workflow** again.
4. Open the completed run, expand **Artifacts**, and download `mori-windows-unsigned` only to inspect the build output. It is not a trusted install package and may be blocked by Smart App Control.

The workflow runs `npm ci`, tests, the frontend build, and Tauri packaging on `windows-2025`. It uploads an MSI, an NSIS setup executable, and their SHA-256 manifest. It does not read Mori user data or connect to a local OpenClaw Gateway.

## Apply for free signing

SignPath Foundation's free program requires an eligible, actively maintained open-source project with an OSI-approved license and a published release. It may reject applications. Each release also requires approval in SignPath. Mori uses MIT; review the upstream dependency and image licenses before publishing. [SignPath Foundation eligibility](https://signpath.org/terms)

After the first public source release:

1. Open [SignPath Foundation](https://signpath.org/) and apply for a free SignPath.io subscription.
2. In SignPath, connect the public GitHub repository using the **GitHub.com** trusted build system, create a project with slug `mori`, and create the `release-signing` policy.
3. Create an artifact configuration named `app-executable` for the ZIP containing `mori-desktop-pet.exe`, and another named `windows-installers` for the ZIP containing the MSI and NSIS setup executable. Configure each to sign the expected Authenticode files.
4. In the GitHub repository, open **Settings > Environments > New environment**, create `release-signing`, and require your own account as a reviewer.
5. Open **Settings > Secrets and variables > Actions**. Add `SIGNPATH_API_TOKEN` as a repository secret. Add `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_APP_CONFIGURATION` (`app-executable`), and `SIGNPATH_INSTALLER_CONFIGURATION` (`windows-installers`) as repository variables. Never put the API token in a workflow file or commit it.
6. In SignPath, enable manual approval for the release signing policy and configure its GitHub origin checks to require GitHub-hosted runners.

The signed workflow signs the Mori executable first, verifies it, then packages that signed file into MSI and NSIS installers and submits those installer files for signing. The Windows Credential Manager integration is statically linked into the Mori executable, and the packaged Node service is checked to contain no native `.node` add-ons. A separate, write-enabled job attaches the verified files to the existing GitHub release. The signing job has read-only GitHub permissions. The package configuration and policy slugs must match the values created in SignPath.

## Publish and install a signed release

1. Create a version tag and public GitHub release after SignPath accepts the project. Include a **Code signing policy** section in the release description linking to the policy section on the project home page.
2. In GitHub, open **Actions > Signed Windows release > Run workflow**, enter the existing release tag, then start the workflow.
3. Approve the run in the GitHub `release-signing` environment. If SignPath requests approval, review and approve the signing request there as well.
4. Verify the uploaded `SHA256SUMS.txt` against the downloaded MSI and NSIS setup file. In Windows, check the Mori executable and each installer file's **Properties > Digital Signatures** tab before installation.
5. Keep Smart App Control enabled. Install one signed package and confirm Mori starts. Then connect to the existing local OpenClaw Gateway and test a supervised desktop task, pause, and result return.

If SignPath does not accept the project, do not distribute unsigned packages as trusted installers. The fallback is private Microsoft Store distribution as MSIX, which requires a separate packaging adaptation and Store certification.
