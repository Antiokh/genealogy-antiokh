param(
  [string]$SourceRoot = 'D:\obsidian\antiokh\Work Ideas\MyHeritage Exporter'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $SourceRoot)) {
  throw "MyHeritage export folder not found: $SourceRoot"
}

$env:MYHERITAGE_EXPORT_ROOT = (Resolve-Path $SourceRoot).Path
Write-Host "Importing MyHeritage media from $env:MYHERITAGE_EXPORT_ROOT"

node scripts/import-myheritage-media.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ''
Write-Host 'Generated:'
Write-Host '  src/content/docs/media/myheritage/'
Write-Host '  imports/myheritage-2026/media-import-report.json'
Write-Host ''
Write-Host 'Validate with: npm run check; npm run build'
