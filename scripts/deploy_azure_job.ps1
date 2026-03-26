param(
    [string]$ResourceGroup = "subash-rg",
    [string]$RegistryName = "subash",
    [string]$JobName = "subash-new-automation",
    [string]$EnvironmentResourceId = "/subscriptions/f508189d-6f3f-42e0-9ddd-2e3d5455e9e6/resourceGroups/ISL-centralindia/providers/Microsoft.App/managedEnvironments/isl-collage-env"
 
)
$tag = (Get-Date -Format "yyyyMMddHHmmss")
$ImageName = "${JobName}:$tag"
$ErrorActionPreference = "Stop"

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$CommandParts,
        [switch]$CaptureOutput,
        [string]$DisplayText
    )

    if ($CommandParts.Count -eq 0) {
        throw "CommandParts cannot be empty."
    }

    if ($DisplayText) {
        $commandText = $DisplayText
    } else {
        $commandText = ($CommandParts | ForEach-Object {
            if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
        }) -join " "
    }
    Write-Host ">> $commandText"

    if ($CaptureOutput) {
        $result = & $CommandParts[0] $CommandParts[1..($CommandParts.Count - 1)] 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed ($LASTEXITCODE): $commandText`n$result"
        }
        return $result
    }

    & $CommandParts[0] $CommandParts[1..($CommandParts.Count - 1)]
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $commandText"
    }
}

function Add-KeyValueIfPresent {
    param(
        [System.Collections.Generic.List[string]]$Target,
        [Parameter(Mandatory = $true)]
        [string]$Key,
        [AllowEmptyString()]
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return
    }

    $Target.Add("${Key}=${Value}")
}

function Get-EnvMap {
    param([string]$Path)

    $map = @{}
    if (-not (Test-Path $Path)) {
        return $map
    }

    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }

        $parts = $trimmed -split "=", 2
        if ($parts.Count -ne 2) {
            continue
        }

        $map[$parts[0].Trim()] = $parts[1].Trim()
    }

    return $map
}

$envPath = "config/.env"
$clientSecretPath = "config/client_secret.json"
$tokenPath = "data/output/token.json"

if (-not (Test-Path $envPath)) {
    Write-Host "Missing $envPath. Create it first." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $clientSecretPath)) {
    Write-Host "Missing $clientSecretPath. Download OAuth client JSON into this path." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $tokenPath)) {
    Write-Host "Missing $tokenPath. Run a local upload once to generate a token, or place one here." -ForegroundColor Red
    exit 1
}

$envMap = Get-EnvMap $envPath
$clientSecretJson = Get-Content $clientSecretPath -Raw
$tokenJson = Get-Content $tokenPath -Raw
$clientSecretJsonB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($clientSecretJson))
$tokenJsonB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($tokenJson))
$jobCpu = if ([string]::IsNullOrWhiteSpace($env:AZURE_JOB_CPU)) { "1" } else { $env:AZURE_JOB_CPU }
$jobMemory = if ([string]::IsNullOrWhiteSpace($env:AZURE_JOB_MEMORY)) { "2Gi" } else { $env:AZURE_JOB_MEMORY }

$loginServer = "$RegistryName.azurecr.io"
$fullImage = "$loginServer/$ImageName"

try {
    Invoke-ExternalCommand -CommandParts @("az", "acr", "build", "-r", $RegistryName, "-t", $ImageName, ".")
} catch {
    Write-Host "ACR Tasks unavailable. Falling back to local Docker build and push."
    $acrTempJson = Invoke-ExternalCommand -CommandParts @("az", "acr", "credential", "show", "-n", $RegistryName) -CaptureOutput
    $acrTemp = $acrTempJson | ConvertFrom-Json

    Invoke-ExternalCommand -CommandParts @(
        "docker", "login", $loginServer,
        "--username", $acrTemp.username,
        "--password", $acrTemp.passwords[0].value
    )
    Invoke-ExternalCommand -CommandParts @("docker", "build", "-t", $fullImage, ".")
    Invoke-ExternalCommand -CommandParts @("docker", "push", $fullImage)
}

$acrJson = Invoke-ExternalCommand -CommandParts @("az", "acr", "credential", "show", "-n", $RegistryName) -CaptureOutput
$acr = $acrJson | ConvertFrom-Json
$acrUser = $acr.username
$acrPass = $acr.passwords[0].value

$secretArgs = New-Object System.Collections.Generic.List[string]
Add-KeyValueIfPresent -Target $secretArgs -Key "gemini-api-key" -Value $envMap["GEMINI_API_KEY"]
Add-KeyValueIfPresent -Target $secretArgs -Key "openai-api-key" -Value $envMap["OPENAI_API_KEY"]
Add-KeyValueIfPresent -Target $secretArgs -Key "anthropic-api-key" -Value $envMap["ANTHROPIC_API_KEY"]
Add-KeyValueIfPresent -Target $secretArgs -Key "gnews-api-key" -Value $envMap["GNEWS_API_KEY"]
Add-KeyValueIfPresent -Target $secretArgs -Key "news-api-key" -Value $envMap["NEWS_API_KEY"]
Add-KeyValueIfPresent -Target $secretArgs -Key "youtube-data-api-key" -Value $envMap["YOUTUBE_DATA_API_KEY"]
Add-KeyValueIfPresent -Target $secretArgs -Key "pexels-api-key" -Value $envMap["PEXELS_API_KEY"]
Add-KeyValueIfPresent -Target $secretArgs -Key "pixabay-api-key" -Value $envMap["PIXABAY_API_KEY"]
Add-KeyValueIfPresent -Target $secretArgs -Key "yt-client-b64" -Value $clientSecretJsonB64
Add-KeyValueIfPresent -Target $secretArgs -Key "yt-token-b64" -Value $tokenJsonB64
Add-KeyValueIfPresent -Target $secretArgs -Key "telegram-bot-token" -Value $envMap["TELEGRAM_BOT_TOKEN"]
Add-KeyValueIfPresent -Target $secretArgs -Key "telegram-allowed-chat-id" -Value $envMap["TELEGRAM_ALLOWED_CHAT_ID"]
Add-KeyValueIfPresent -Target $secretArgs -Key "azure-client-secret" -Value $envMap["AZURE_CLIENT_SECRET"]

$envArgs = New-Object System.Collections.Generic.List[string]
Add-KeyValueIfPresent -Target $envArgs -Key "AI_PROVIDER" -Value $envMap["AI_PROVIDER"]
Add-KeyValueIfPresent -Target $envArgs -Key "GEMINI_MODEL" -Value $envMap["GEMINI_MODEL"]
Add-KeyValueIfPresent -Target $envArgs -Key "GEMINI_FALLBACK_MODEL" -Value $envMap["GEMINI_FALLBACK_MODEL"]
Add-KeyValueIfPresent -Target $envArgs -Key "GEMINI_FALLBACK_MODELS" -Value $envMap["GEMINI_FALLBACK_MODELS"]
Add-KeyValueIfPresent -Target $envArgs -Key "OPENAI_MODEL" -Value $envMap["OPENAI_MODEL"]
Add-KeyValueIfPresent -Target $envArgs -Key "ANTHROPIC_MODEL" -Value $envMap["ANTHROPIC_MODEL"]
Add-KeyValueIfPresent -Target $envArgs -Key "DEFAULT_NICHE" -Value $envMap["DEFAULT_NICHE"]
Add-KeyValueIfPresent -Target $envArgs -Key "LOG_LEVEL" -Value $envMap["LOG_LEVEL"]
Add-KeyValueIfPresent -Target $envArgs -Key "RUN_MODE" -Value $envMap["RUN_MODE"]
Add-KeyValueIfPresent -Target $envArgs -Key "EDGE_TTS_VOICE" -Value $envMap["EDGE_TTS_VOICE"]
Add-KeyValueIfPresent -Target $envArgs -Key "CLIPS_DIR" -Value $envMap["CLIPS_DIR"]
Add-KeyValueIfPresent -Target $envArgs -Key "USED_CLIPS_FILE" -Value $envMap["USED_CLIPS_FILE"]
Add-KeyValueIfPresent -Target $envArgs -Key "DOWNLOAD_UPLOADED_VIDEO" -Value $envMap["DOWNLOAD_UPLOADED_VIDEO"]
Add-KeyValueIfPresent -Target $envArgs -Key "CLEANUP_LOCAL_FILES_AFTER_UPLOAD" -Value $envMap["CLEANUP_LOCAL_FILES_AFTER_UPLOAD"]
Add-KeyValueIfPresent -Target $envArgs -Key "VALIDATE_SHORTS_BEFORE_UPLOAD" -Value $envMap["VALIDATE_SHORTS_BEFORE_UPLOAD"]
Add-KeyValueIfPresent -Target $envArgs -Key "STRICT_SHORTS_VALIDATION" -Value $envMap["STRICT_SHORTS_VALIDATION"]
Add-KeyValueIfPresent -Target $envArgs -Key "VIDEOS_PER_DAY" -Value $envMap["VIDEOS_PER_DAY"]
Add-KeyValueIfPresent -Target $envArgs -Key "SCENE_DURATION" -Value $envMap["SCENE_DURATION"]
Add-KeyValueIfPresent -Target $envArgs -Key "MIN_VIDEO_LENGTH" -Value $envMap["MIN_VIDEO_LENGTH"]
Add-KeyValueIfPresent -Target $envArgs -Key "MAX_VIDEO_LENGTH" -Value $envMap["MAX_VIDEO_LENGTH"]
Add-KeyValueIfPresent -Target $envArgs -Key "MIN_SCRIPT_SECONDS" -Value $envMap["MIN_SCRIPT_SECONDS"]
Add-KeyValueIfPresent -Target $envArgs -Key "MAX_SCRIPT_SECONDS" -Value $envMap["MAX_SCRIPT_SECONDS"]
Add-KeyValueIfPresent -Target $envArgs -Key "NEWS_QUERY" -Value $envMap["NEWS_QUERY"]
Add-KeyValueIfPresent -Target $envArgs -Key "NEWS_LANGUAGE" -Value $envMap["NEWS_LANGUAGE"]
Add-KeyValueIfPresent -Target $envArgs -Key "NEWS_LOOKBACK_HOURS" -Value $envMap["NEWS_LOOKBACK_HOURS"]
Add-KeyValueIfPresent -Target $envArgs -Key "NEWS_FETCH_MULTIPLIER" -Value $envMap["NEWS_FETCH_MULTIPLIER"]
Add-KeyValueIfPresent -Target $envArgs -Key "YOUTUBE_CLIENT_SECRET_FILE" -Value $envMap["YOUTUBE_CLIENT_SECRET_FILE"]
Add-KeyValueIfPresent -Target $envArgs -Key "YOUTUBE_DATA_API_KEY" -Value $envMap["YOUTUBE_DATA_API_KEY"]
Add-KeyValueIfPresent -Target $envArgs -Key "YOUTUBE_REGION_CODE" -Value $envMap["YOUTUBE_REGION_CODE"]
Add-KeyValueIfPresent -Target $envArgs -Key "TELEGRAM_POLL_TIMEOUT" -Value $envMap["TELEGRAM_POLL_TIMEOUT"]
Add-KeyValueIfPresent -Target $envArgs -Key "TELEGRAM_MAX_COUNT" -Value $envMap["TELEGRAM_MAX_COUNT"]
Add-KeyValueIfPresent -Target $envArgs -Key "TELEGRAM_RUN_TARGET" -Value $envMap["TELEGRAM_RUN_TARGET"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_JOB_NAME" -Value $envMap["AZURE_JOB_NAME"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_JOB_NAME_PRIMARY" -Value $envMap["AZURE_JOB_NAME_PRIMARY"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_JOB_NAME_SECONDARY" -Value $envMap["AZURE_JOB_NAME_SECONDARY"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_JOB_LABEL_PRIMARY" -Value $envMap["AZURE_JOB_LABEL_PRIMARY"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_JOB_LABEL_SECONDARY" -Value $envMap["AZURE_JOB_LABEL_SECONDARY"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_RESOURCE_GROUP" -Value $envMap["AZURE_RESOURCE_GROUP"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_SUBSCRIPTION_ID" -Value $envMap["AZURE_SUBSCRIPTION_ID"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_TENANT_ID" -Value $envMap["AZURE_TENANT_ID"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_CLIENT_ID" -Value $envMap["AZURE_CLIENT_ID"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_ARM_API_VERSION" -Value $envMap["AZURE_ARM_API_VERSION"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_SYNC_TOKEN_TO_JOB" -Value $envMap["AZURE_SYNC_TOKEN_TO_JOB"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_TOKEN_SECRET_NAME" -Value $envMap["AZURE_TOKEN_SECRET_NAME"]

if (-not [string]::IsNullOrWhiteSpace($envMap["GEMINI_API_KEY"])) {
    $envArgs.Add("GEMINI_API_KEY=secretref:gemini-api-key")
}
if (-not [string]::IsNullOrWhiteSpace($envMap["OPENAI_API_KEY"])) {
    $envArgs.Add("OPENAI_API_KEY=secretref:openai-api-key")
}
if (-not [string]::IsNullOrWhiteSpace($envMap["ANTHROPIC_API_KEY"])) {
    $envArgs.Add("ANTHROPIC_API_KEY=secretref:anthropic-api-key")
}
if (-not [string]::IsNullOrWhiteSpace($envMap["GNEWS_API_KEY"])) {
    $envArgs.Add("GNEWS_API_KEY=secretref:gnews-api-key")
}
if (-not [string]::IsNullOrWhiteSpace($envMap["NEWS_API_KEY"])) {
    $envArgs.Add("NEWS_API_KEY=secretref:news-api-key")
}
if (-not [string]::IsNullOrWhiteSpace($envMap["YOUTUBE_DATA_API_KEY"])) {
    $envArgs.Add("YOUTUBE_DATA_API_KEY=secretref:youtube-data-api-key")
}
if (-not [string]::IsNullOrWhiteSpace($envMap["PEXELS_API_KEY"])) {
    $envArgs.Add("PEXELS_API_KEY=secretref:pexels-api-key")
}
if (-not [string]::IsNullOrWhiteSpace($envMap["PIXABAY_API_KEY"])) {
    $envArgs.Add("PIXABAY_API_KEY=secretref:pixabay-api-key")
}
if ([string]::IsNullOrWhiteSpace($envMap["YOUTUBE_CLIENT_SECRET_FILE"])) {
    $envArgs.Add("YOUTUBE_CLIENT_SECRET_FILE=config/client_secret.json")
}
$envArgs.Add("AZURE_CLIENT_SECRET=secretref:azure-client-secret")
$envArgs.Add("YOUTUBE_CLIENT_SECRET_B64=secretref:yt-client-b64")
$envArgs.Add("YOUTUBE_TOKEN_B64=secretref:yt-token-b64")
$envArgs.Add("TELEGRAM_BOT_TOKEN=secretref:telegram-bot-token")
$envArgs.Add("TELEGRAM_ALLOWED_CHAT_ID=secretref:telegram-allowed-chat-id")
$envArgs.Add("RUN_COUNT=1")

$jobExists = $false
try {
    Invoke-ExternalCommand -CommandParts @("az", "containerapp", "job", "show", "-n", $JobName, "-g", $ResourceGroup) | Out-Null
    $jobExists = $true
} catch {
    $jobExists = $false
}

if ($jobExists) {
    Invoke-ExternalCommand -CommandParts (
        @(
            "az", "containerapp", "job", "secret", "set",
            "-n", $JobName,
            "-g", $ResourceGroup,
            "--secrets"
        ) + $secretArgs
    ) -DisplayText "az containerapp job secret set -n $JobName -g $ResourceGroup --secrets <hidden>"

    Invoke-ExternalCommand -CommandParts @(
        "az", "containerapp", "job", "registry", "set",
        "-n", $JobName,
        "-g", $ResourceGroup,
        "--server", $loginServer,
        "--username", $acrUser,
        "--password", $acrPass
    ) -DisplayText "az containerapp job registry set -n $JobName -g $ResourceGroup --server $loginServer --username <hidden> --password <hidden>"

    Invoke-ExternalCommand -CommandParts (
        @(
            "az", "containerapp", "job", "update",
            "-n", $JobName,
            "-g", $ResourceGroup,
            "--image", $fullImage,
            "--cpu", $jobCpu,
            "--memory", $jobMemory,
            "--set-env-vars"
        ) + $envArgs
    ) -DisplayText "az containerapp job update -n $JobName -g $ResourceGroup --image $fullImage --cpu $jobCpu --memory $jobMemory --set-env-vars <configured>"
} else {
    Invoke-ExternalCommand -CommandParts (
        @(
            "az", "containerapp", "job", "create",
            "-n", $JobName,
            "-g", $ResourceGroup,
            "--environment", $EnvironmentResourceId,
            "--trigger-type", "Manual",
            "--cpu", $jobCpu,
            "--memory", $jobMemory,
            "--parallelism", "1",
            "--replica-completion-count", "1",
            "--replica-retry-limit", "0",
            "--replica-timeout", "3600",
            "--registry-server", $loginServer,
            "--registry-username", $acrUser,
            "--registry-password", $acrPass,
            "--secrets"
        ) + $secretArgs + @("--env-vars") + $envArgs
    ) -DisplayText "az containerapp job create -n $JobName -g $ResourceGroup --environment $EnvironmentResourceId --trigger-type Manual --image $fullImage --cpu $jobCpu --memory $jobMemory --parallelism 1 --replica-completion-count 1 --replica-retry-limit 0 --replica-timeout 3600 --registry-server $loginServer --registry-username <hidden> --registry-password <hidden> --secrets <hidden> --env-vars <configured>"
}

Write-Host "Azure job ready: $JobName"
Write-Host "Image: $fullImage"
