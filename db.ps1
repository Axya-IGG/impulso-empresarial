<#
    Aplica SQL no banco D1 do Impulso Empresarial (impulso-db).

    Mesma conta/perfil wrangler do deploy.ps1 (Axya, ferramentasaxya@gmail.com).
    Por padrao aplica em PRODUCAO — use -Local para testar num banco sqlite
    local (o do `wrangler d1 execute --local`) antes de tocar no de verdade.

    Uso:
      .\db.ps1 -Arquivo schema.sql                    # aplica em producao
      .\db.ps1 -Arquivo migrations\002_compras.sql     # idem, outro arquivo
      .\db.ps1 -Arquivo schema.sql -Local              # banco local, para testar
      .\db.ps1 -Comando "SELECT COUNT(*) FROM leads"   # query direta, sem arquivo
#>

[CmdletBinding()]
param(
    [string]$Arquivo,
    [string]$Comando,
    [switch]$Local
)

$ErrorActionPreference = 'Stop'

if (-not $Arquivo -and -not $Comando) {
    throw "Informe -Arquivo <caminho.sql> ou -Comando `"<SQL>`"."
}
if ($Arquivo -and $Comando) {
    throw "Use -Arquivo OU -Comando, nao os dois."
}

$RepoRoot    = $PSScriptRoot
$DbName      = 'impulso-db'
$AccountId   = 'a052a251e6dabe597ed19b6d35829970'   # ferramentasaxya@gmail.com
$WranglerCfg = Join-Path $env:USERPROFILE '.wrangler-axya'

# Mesmo raciocinio do deploy.ps1: perfil isolado da Axya para nao conflitar
# com o login da AR&D, e CLOUDFLARE_ACCOUNT_ID para nao herdar o account id
# em cache de um .wrangler/ de diretorio pai.
if (Test-Path -LiteralPath (Join-Path $WranglerCfg '.wrangler\config\default.toml')) {
    $env:XDG_CONFIG_HOME = $WranglerCfg
}
$env:CLOUDFLARE_ACCOUNT_ID = $AccountId

# node direto no wrangler.js: o lancador do npx passa pelo cmd.exe, que
# quebra em perfis de usuario com '&' no nome (ex.: "AR&D Assessoria").
$WranglerJs = Join-Path $env:APPDATA 'npm\node_modules\wrangler\bin\wrangler.js'
function Invoke-Wrangler {
    $cmdArgs = @($args)
    if (Test-Path -LiteralPath $WranglerJs) { node $WranglerJs @cmdArgs }
    else { npx wrangler @cmdArgs }
}

if (-not $Local) {
    # Mesma checagem do deploy.ps1, pelo mesmo motivo: aplicar SQL na conta
    # errada e muito pior que publicar arquivo estatico na conta errada.
    $whoami = & {
        $ErrorActionPreference = 'Continue'
        Invoke-Wrangler whoami 2>&1 | Out-String
    }
    if ($whoami -notmatch [regex]::Escape($AccountId)) {
        Write-Host $whoami
        throw "wrangler nao esta logado na conta da Axya ($AccountId). Rode 'wrangler login' com ferramentasaxya@gmail.com."
    }
    Write-Host "Conta Cloudflare confirmada: $AccountId" -ForegroundColor DarkGray
    Write-Host "Aplicando em PRODUCAO ($DbName)..." -ForegroundColor Yellow
}
else {
    Write-Host "Aplicando no banco LOCAL ($DbName)..." -ForegroundColor DarkGray
}

# --config aqui e so para o `d1 execute` (comando generico, nao e' `pages
# dev`) — funciona apontar pro wrangler.pages.toml sem precisar copia-lo
# para wrangler.toml, diferente do que acontece com `wrangler pages dev`.
Push-Location $RepoRoot
try {
    $alvo = if ($Local) { '--local' } else { '--remote' }
    if ($Arquivo) {
        Invoke-Wrangler d1 execute $DbName $alvo '--config=wrangler.pages.toml' "--file=$Arquivo"
    }
    else {
        Invoke-Wrangler d1 execute $DbName $alvo '--config=wrangler.pages.toml' "--command=$Comando"
    }
    if ($LASTEXITCODE -ne 0) { throw "wrangler retornou codigo $LASTEXITCODE" }
}
finally {
    Pop-Location
}
