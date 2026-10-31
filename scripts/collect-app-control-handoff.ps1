[CmdletBinding()]
param(
    [string[]]$ArtifactPath = @(),
    [string]$ReportPath = '',
    [switch]$OpenWindowsSecurity
)

$ErrorActionPreference = 'Continue'
if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $ReportPath = Join-Path $PSScriptRoot '..\mori-app-control-handoff.txt'
}
$os = Get-CimInstance Win32_OperatingSystem
$smartAppControlPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy'
$smartAppControl = Get-ItemProperty -Path $smartAppControlPath -Name VerifiedAndReputablePolicyState -ErrorAction SilentlyContinue
$ciToolPath = Join-Path $env:WINDIR 'System32\CiTool.exe'
$ciToolResult = 'CiTool was not found.'
$ciToolExitCode = $null

if (Test-Path -LiteralPath $ciToolPath) {
    $ciToolResult = (& $ciToolPath -lp -json 2>&1 | Out-String).Trim()
    $ciToolExitCode = $LASTEXITCODE
}

$artifacts = foreach ($path in $ArtifactPath) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        [pscustomobject]@{ Path = $path; Error = 'File not found.' }
        continue
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $path
    $signer = if ($signature.SignerCertificate) { $signature.SignerCertificate } else { $null }
    [pscustomobject]@{
        Path = (Resolve-Path -LiteralPath $path).Path
        SHA256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        SignatureStatus = [string]$signature.Status
        Publisher = if ($signer) { $signer.Subject } else { '' }
        CertificateThumbprint = if ($signer) { $signer.Thumbprint } else { '' }
        Timestamp = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { '' }
    }
}

$smartAppState = if ($null -eq $smartAppControl) { 'Not reported in the Smart App Control registry value.' } else {
    switch ($smartAppControl.VerifiedAndReputablePolicyState) {
        0 { 'Off' }
        1 { 'On' }
        2 { 'Evaluation' }
        default { "Unknown value: $($smartAppControl.VerifiedAndReputablePolicyState)" }
    }
}

$report = @"
Mori Windows Application Control handoff
Collected: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')
Computer: $([Environment]::MachineName)
Windows: $($os.Caption) $($os.Version) (build $($os.BuildNumber))
Smart App Control: $smartAppState
CiTool exit code: $ciToolExitCode

Active policy listing (CiTool -lp -json):
$ciToolResult

Artifact signatures and SHA-256:
$($artifacts | ConvertTo-Json -Depth 4)

Administrator action:
Review the active policies and artifact signer/hash. Add the approved Mori publisher or artifact using the organization's existing Application Control deployment process. Do not disable Application Control.
Microsoft CiTool documentation: https://learn.microsoft.com/en-us/windows/security/threat-protection/windows-defender-application-control/operations/citool-commands
"@

if ($ciToolExitCode -eq -2147024891) {
    $report += "`r`nCiTool access was denied. An administrator can rerun this read-only report from an elevated PowerShell session to collect active policy details."
}

$absoluteReportPath = [System.IO.Path]::GetFullPath($ReportPath)
$reportDirectory = Split-Path -Parent $absoluteReportPath
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
Set-Content -LiteralPath $absoluteReportPath -Value $report -Encoding utf8
Write-Output "Wrote read-only policy and signing report: $absoluteReportPath"

if ($OpenWindowsSecurity -and $smartAppControl -and $smartAppControl.VerifiedAndReputablePolicyState -in 1, 2) {
    Start-Process 'windowsdefender://appbrowser'
} elseif ($OpenWindowsSecurity) {
    Write-Output 'Smart App Control was not identified. Give this report to the administrator who manages this device Application Control policy.'
}
