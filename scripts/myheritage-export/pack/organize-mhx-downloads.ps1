param(
    [string]$Source = "$env:USERPROFILE\Downloads",
    [string]$Destination = "$PWD\myheritage-export",
    [switch]$Move
)

$ErrorActionPreference = "Stop"
$prefix = "MHX__"

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$files = Get-ChildItem -LiteralPath $Source -File |
    Where-Object { $_.Name.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) }

if (-not $files) {
    Write-Host "No MHX__ files found in $Source"
    exit 0
}

foreach ($file in $files) {
    $relative = $file.Name.Substring($prefix.Length)
    $parts = $relative -split "__"

    if ($parts.Count -eq 1) {
        $targetDir = $Destination
        $targetName = $parts[0]
    }
    else {
        $targetDir = Join-Path $Destination ($parts[0..($parts.Count - 2)] -join "\")
        $targetName = $parts[-1]
    }

    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    $target = Join-Path $targetDir $targetName

    if (Test-Path -LiteralPath $target) {
        $stem = [System.IO.Path]::GetFileNameWithoutExtension($targetName)
        $ext  = [System.IO.Path]::GetExtension($targetName)
        $n = 2

        do {
            $candidate = Join-Path $targetDir ("{0}_{1}{2}" -f $stem, $n, $ext)
            $n++
        } while (Test-Path -LiteralPath $candidate)

        $target = $candidate
    }

    if ($Move) {
        Move-Item -LiteralPath $file.FullName -Destination $target
        Write-Host "MOVE $($file.Name) -> $target"
    }
    else {
        Copy-Item -LiteralPath $file.FullName -Destination $target
        Write-Host "COPY $($file.Name) -> $target"
    }
}

Write-Host ""
Write-Host "Done: $Destination"
