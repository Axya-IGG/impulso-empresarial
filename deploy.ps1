<#
    Deploy da landing page Impulso Empresarial para o Cloudflare Pages.

    Publica a partir de um diretório temporário contendo APENAS os arquivos do
    site. Isso importa porque o `wrangler pages deploy` NÃO respeita o
    .gitignore: apontar direto para a raiz do repositório subiria também a
    pasta de arquivos-fonte de design (~5 MB), que ficaria acessível
    publicamente.

    A conta do Cloudflare é a da Axya (ferramentasaxya@gmail.com), cujas
    credenciais ficam num perfil wrangler isolado para não conflitar com o
    login da AR&D. Daí as duas variáveis de ambiente abaixo.

    Uso:
      .\deploy.ps1              # publica em produção
      .\deploy.ps1 -Preview     # publica numa branch de preview (URL própria)
      .\deploy.ps1 -WhatIf      # só lista o que seria enviado
#>

[CmdletBinding()]
param(
    [switch]$Preview,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$RepoRoot    = $PSScriptRoot
$ProjectName = 'impulso-empresarial'
$AccountId   = 'a052a251e6dabe597ed19b6d35829970'   # Ferramentasaxya@gmail.com
$WranglerCfg = Join-Path $env:USERPROFILE '.wrangler-axya'

# Arquivos e pastas que compõem o site publicado.
$Files = @(
    'index.html', 'style.css', 'script.js',
    '_headers', '_redirects',
    'favicon.ico', 'favicon-32.png', 'favicon-192.png', 'apple-touch-icon.png'
)
# assets/ = otimizados nesta máquina; images/ = fotos das palestrantes e logos
# das realizadoras. São duas convenções por razões históricas; ambas publicam.
$Dirs = @('assets', 'images')

# --- monta o diretório de publicação -------------------------------------
$Stage = Join-Path ([System.IO.Path]::GetTempPath()) ("impulso-deploy-" + (Get-Date -Format 'yyyyMMddHHmmss'))
New-Item -ItemType Directory -Path $Stage | Out-Null

$missing = @()
foreach ($f in $Files) {
    $p = Join-Path $RepoRoot $f
    if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $Stage }
    else { $missing += $f }
}
foreach ($d in $Dirs) {
    $p = Join-Path $RepoRoot $d
    if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $Stage -Recurse }
    else { $missing += "$d/" }
}

if ($missing.Count -gt 0) {
    throw "Arquivos esperados não encontrados no repositório: $($missing -join ', ')"
}

$staged = Get-ChildItem -LiteralPath $Stage -Recurse -File
$totalKb = [math]::Round(($staged | Measure-Object Length -Sum).Sum / 1KB)
Write-Host "Diretorio de publicacao: $($staged.Count) arquivos, $totalKb KB" -ForegroundColor Cyan
$staged | ForEach-Object { "  " + $_.FullName.Replace("$Stage\", '') } | Sort-Object | Write-Host

if ($WhatIf) {
    Write-Host "`n-WhatIf: nada foi publicado." -ForegroundColor Yellow
    Write-Host "Conteudo montado em: $Stage"
    return
}

# --- publica --------------------------------------------------------------
# XDG_CONFIG_HOME aponta para o perfil da Axya; sem ele o wrangler usa o
# login da AR&D. CLOUDFLARE_ACCOUNT_ID evita que ele herde o account id em
# cache de .wrangler/ de um diretorio pai.
$env:XDG_CONFIG_HOME        = $WranglerCfg
$env:CLOUDFLARE_ACCOUNT_ID  = $AccountId

$branch = if ($Preview) { "preview-$(Get-Date -Format 'yyyyMMdd-HHmm')" } else { 'master' }

Write-Host "`nPublicando em '$ProjectName' (branch: $branch)..." -ForegroundColor Cyan
Push-Location $Stage
try {
    npx wrangler pages deploy . --project-name=$ProjectName --branch=$branch --commit-dirty=true
    if ($LASTEXITCODE -ne 0) { throw "wrangler retornou codigo $LASTEXITCODE" }
}
finally {
    Pop-Location
}

if (-not $Preview) {
    Write-Host "`nProducao: https://oimpulsoempresarial.com.br" -ForegroundColor Green
}
