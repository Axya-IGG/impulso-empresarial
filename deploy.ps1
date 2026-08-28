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
# pre-venda.html fica na raiz de proposito: o Pages serve HTML sem a
# extensao, entao ele responde em /pre-venda e os caminhos relativos de
# assets/ e images/ continuam validos, o que nao aconteceria numa subpasta.
$Files = @(
    'index.html', 'pre-venda.html', 'style.css', 'script.js',
    'admin.html', 'admin.css', 'admin.js',
    '_headers', '_redirects',
    'favicon.ico', 'favicon-32.png', 'favicon-192.png', 'apple-touch-icon.png'
)
# assets/ = otimizados nesta máquina; images/ = fotos das palestrantes e logos
# das realizadoras. São duas convenções por razões históricas; ambas publicam.
$Dirs = @('assets', 'images')

# --- monta o diretório de publicação -------------------------------------
# O stage reproduz o layout que o Pages espera quando o projeto tem API:
#
#   stage/wrangler.toml   (copia de wrangler.pages.toml, com os bindings)
#   stage/public/         (os estáticos — é o pages_build_output_dir)
#   stage/functions/      (as Pages Functions)
#
# As Functions ficam FORA de public/ porque tudo que está no diretório de
# saída vira arquivo servido publicamente: dentro dele, o código da API
# seria baixável em /functions/_lib.js.
$Stage    = Join-Path ([System.IO.Path]::GetTempPath()) ("impulso-deploy-" + (Get-Date -Format 'yyyyMMddHHmmss'))
$StagePub = Join-Path $Stage 'public'
New-Item -ItemType Directory -Path $StagePub -Force | Out-Null

$missing = @()
foreach ($f in $Files) {
    $p = Join-Path $RepoRoot $f
    if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $StagePub }
    else { $missing += $f }
}
foreach ($d in $Dirs) {
    $p = Join-Path $RepoRoot $d
    if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $StagePub -Recurse }
    else { $missing += "$d/" }
}

$fnOrigem = Join-Path $RepoRoot 'functions'
if (Test-Path -LiteralPath $fnOrigem) { Copy-Item -LiteralPath $fnOrigem -Destination $Stage -Recurse }
else { $missing += 'functions/' }

$cfgOrigem = Join-Path $RepoRoot 'wrangler.pages.toml'
if (Test-Path -LiteralPath $cfgOrigem) { Copy-Item -LiteralPath $cfgOrigem -Destination (Join-Path $Stage 'wrangler.toml') }
else { $missing += 'wrangler.pages.toml' }

if ($missing.Count -gt 0) {
    throw "Arquivos esperados não encontrados no repositório: $($missing -join ', ')"
}

# --- versiona os assets pelo conteúdo -------------------------------------
# O `?v=` no HTML existe para furar o cache, mas só cumpre esse papel se
# mudar quando o arquivo muda. Manter isso na mão não funciona: em 28/08 o
# script.js e o style.css foram alterados sem bump; como o _headers marca
# JS/CSS como `immutable` por um ano, a borda da Cloudflare e os navegadores
# seguiram servindo a versão velha (cf-cache-status: HIT, Age: 60068) e as
# mudanças simplesmente não apareceram no site publicado.
#
# Aqui o valor sai do hash do próprio conteúdo: muda sozinho quando o
# arquivo muda, e continua igual quando não muda (preservando o cache).
$semBom = New-Object System.Text.UTF8Encoding($false)
$htmls  = @(Get-ChildItem -LiteralPath $StagePub -Filter *.html -File)

foreach ($asset in @('style.css', 'script.js', 'admin.css', 'admin.js')) {
    $caminho = Join-Path $StagePub $asset
    if (-not (Test-Path -LiteralPath $caminho)) { continue }

    $hash = (Get-FileHash -LiteralPath $caminho -Algorithm SHA256).Hash.Substring(0, 10).ToLower()
    $padrao = [regex]::Escape($asset) + '\?v=[A-Za-z0-9._-]+'

    foreach ($h in $htmls) {
        $txt  = [System.IO.File]::ReadAllText($h.FullName)
        $novo = [regex]::Replace($txt, $padrao, "${asset}?v=$hash")
        if ($novo -ne $txt) { [System.IO.File]::WriteAllText($h.FullName, $novo, $semBom) }
    }
    Write-Host ("  versao: {0,-11} -> {1}" -f $asset, $hash) -ForegroundColor DarkGray
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
# XDG_CONFIG_HOME aponta para o perfil da Axya, usado nas maquinas em que o
# login padrao do wrangler e o da AR&D. Onde esse perfil nao existe, o login
# padrao ja e o da Axya — por isso a checagem de conta logo abaixo, que vale
# nos dois casos. CLOUDFLARE_ACCOUNT_ID evita herdar o account id em cache de
# .wrangler/ de um diretorio pai.
if (Test-Path -LiteralPath (Join-Path $WranglerCfg '.wrangler\config\default.toml')) {
    $env:XDG_CONFIG_HOME = $WranglerCfg
}
$env:CLOUDFLARE_ACCOUNT_ID  = $AccountId

$branch = if ($Preview) { "preview-$(Get-Date -Format 'yyyyMMdd-HHmm')" } else { 'master' }

# O wrangler é chamado via `node caminho\wrangler.js`, e não via `npx`: o
# lançador do npx passa pelo cmd.exe, que quebra em perfis de usuário com '&'
# no nome (ex.: "AR&D Assessoria") — o caminho é truncado no '&' e o módulo
# não é encontrado. Sem instalação global, cai no npx mesmo.
$WranglerJs = Join-Path $env:APPDATA 'npm\node_modules\wrangler\bin\wrangler.js'
function Invoke-Wrangler {
    # O $args precisa ser copiado antes de splatar. No PowerShell 5.1 o splat
    # da variavel automatica se perde quando o comando nativo ja tem um
    # argumento literal antes dele: `npx wrangler @args` chega ao wrangler sem
    # argumento nenhum e ele responde com o help — o que fazia a checagem de
    # conta abaixo acusar "nao esta logado" mesmo com a sessao valida.
    $cmdArgs = @($args)
    if (Test-Path -LiteralPath $WranglerJs) { node $WranglerJs @cmdArgs }
    else { npx wrangler @cmdArgs }
}

# Confere em qual conta o wrangler esta logado ANTES de publicar: publicar na
# conta errada criaria um projeto Pages novo e publico fora do controle da Axya.
$whoami = Invoke-Wrangler whoami 2>&1 | Out-String
if ($whoami -notmatch [regex]::Escape($AccountId)) {
    Write-Host $whoami
    throw "wrangler nao esta logado na conta da Axya ($AccountId). Rode 'wrangler login' com ferramentasaxya@gmail.com."
}
Write-Host "Conta Cloudflare confirmada: $AccountId" -ForegroundColor DarkGray

Write-Host "`nPublicando em '$ProjectName' (branch: $branch)..." -ForegroundColor Cyan
Push-Location $Stage
try {
    # Sem o diretório na linha de comando: quem manda é o pages_build_output_dir
    # do wrangler.toml. Passar "." aqui publicaria functions/ como arquivo
    # estático e deixaria o código da API baixável.
    Invoke-Wrangler pages deploy "--project-name=$ProjectName" "--branch=$branch" --commit-dirty=true
    if ($LASTEXITCODE -ne 0) { throw "wrangler retornou codigo $LASTEXITCODE" }
}
finally {
    Pop-Location
}

if (-not $Preview) {
    Write-Host "`nProducao: https://oimpulsoempresarial.com.br" -ForegroundColor Green
}
