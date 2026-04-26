$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Has-Command($name) {
  return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

Write-Host "Starting UARE Smart Launcher..."
if (-not (Has-Command "node")) {
  if (Has-Command "winget") {
    Write-Host "Node.js not found. Attempting install with winget..."
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  } elseif (Has-Command "choco") {
    Write-Host "Node.js not found. Attempting install with Chocolatey..."
    choco install nodejs-lts -y
  }
}

if (Has-Command "node") {
  node .\start-uare.mjs
} else {
  Write-Host "Node.js could not be installed automatically."
  Write-Host "Install Node.js LTS, then run this launcher again."
  Read-Host "Press Enter to exit"
}
