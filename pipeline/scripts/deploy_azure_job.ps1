param(
    [string]$ResourceGroup = $env:AZURE_RESOURCE_GROUP,
    [string]$RegistryName = $env:AZURE_ACR_NAME,
    [string]$JobName = $env:AZURE_JOB_NAME,
    [string]$ImageRepository = "clipforge-pipeline-worker",
    [string]$ImageTag = $env:AZURE_IMAGE_TAG,
    [string]$EnvironmentResourceId = $env:AZURE_ENVIRONMENT_RESOURCE_ID,
    [bool]$AllowCreate = $false,
    [int]$Parallelism = 2,
    [int]$ReplicaCompletionCount = 1,
    [int]$ReplicaRetryLimit = 0,
    [int]$ReplicaTimeout = 3600

)

# Local convenience: if required AZURE_* values are missing, try pipeline config/.env
$bootstrapEnvPath = Join-Path -Path $PSScriptRoot -ChildPath "..\config\.env"
$bootstrapEnvMap = @{}
if (Test-Path $bootstrapEnvPath) {
    foreach ($line in Get-Content $bootstrapEnvPath) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }

        $parts = $trimmed -split "=", 2
        if ($parts.Count -ne 2) {
            continue
        }

        $bootstrapEnvMap[$parts[0].Trim()] = $parts[1].Trim()
    }

    if ([string]::IsNullOrWhiteSpace($ResourceGroup)) {
        $ResourceGroup = $bootstrapEnvMap["AZURE_RESOURCE_GROUP"]
    }
    if ([string]::IsNullOrWhiteSpace($RegistryName)) {
        $RegistryName = $bootstrapEnvMap["AZURE_ACR_NAME"]
    }
    if ([string]::IsNullOrWhiteSpace($JobName)) {
        $JobName = $bootstrapEnvMap["AZURE_JOB_NAME"]
    }
    if ([string]::IsNullOrWhiteSpace($EnvironmentResourceId)) {
        $EnvironmentResourceId = $bootstrapEnvMap["AZURE_ENVIRONMENT_RESOURCE_ID"]
    }
    if ([string]::IsNullOrWhiteSpace($ImageTag)) {
        $ImageTag = $bootstrapEnvMap["AZURE_IMAGE_TAG"]
    }
}

if ([string]::IsNullOrWhiteSpace($ResourceGroup)) {
    throw "ResourceGroup is required. Set AZURE_RESOURCE_GROUP or pass -ResourceGroup explicitly."
}

if ([string]::IsNullOrWhiteSpace($JobName)) {
    throw "JobName is required. Set AZURE_JOB_NAME or pass -JobName explicitly."
}

if ($ImageRepository.Contains(":")) {
    throw "ImageRepository must not include a tag. Pass only repository name and use -ImageTag for the versioned tag."
}

$defaultImageTag = (Get-Date -Format "yyyyMMdd-HHmmss")
$rawImageTag = if ([string]::IsNullOrWhiteSpace($ImageTag)) {
    $defaultImageTag
} else {
    $ImageTag.Trim().ToLowerInvariant()
}

$normalizedImageTag = ($rawImageTag -replace "[^a-z0-9._-]", "-").Trim("-")
if ([string]::IsNullOrWhiteSpace($normalizedImageTag)) {
    $normalizedImageTag = $defaultImageTag
}
if ($normalizedImageTag -eq "latest") {
    throw "Image tag 'latest' is not allowed. Use a pinned tag such as 20260406-1200 or a commit sha."
}

$normalizedImageRepository = ($ImageRepository.Trim().ToLowerInvariant() -replace "[^a-z0-9._/-]", "-")
if ([string]::IsNullOrWhiteSpace($normalizedImageRepository)) {
    $normalizedImageRepository = "clipforge-pipeline-worker"
}
$ImageName = "${normalizedImageRepository}:$normalizedImageTag"
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

function Get-CurrentPrincipalObjectId {
    try {
        $token = Invoke-ExternalCommand -CommandParts @(
            "az", "account", "get-access-token",
            "--resource", "https://management.azure.com/",
            "--query", "accessToken",
            "-o", "tsv"
        ) -CaptureOutput
        $tokenValue = ($token | Out-String).Trim()
        if ([string]::IsNullOrWhiteSpace($tokenValue)) {
            return ""
        }

        $tokenParts = $tokenValue.Split('.')
        if ($tokenParts.Count -lt 2) {
            return ""
        }

        $payload = $tokenParts[1].Replace('-', '+').Replace('_', '/')
        switch ($payload.Length % 4) {
            2 { $payload += "==" }
            3 { $payload += "=" }
        }

        $jsonPayload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
        $claims = $jsonPayload | ConvertFrom-Json
        return [string]$claims.oid
    } catch {
        return ""
    }
}

function Test-ActionMatchesPattern {
    param(
        [string]$Action,
        [string]$Pattern
    )

    if ([string]::IsNullOrWhiteSpace($Action) -or [string]::IsNullOrWhiteSpace($Pattern)) {
        return $false
    }

    $regexPattern = '^' + [System.Text.RegularExpressions.Regex]::Escape($Pattern.Trim()).Replace("\*", ".*") + '$'
    return [System.Text.RegularExpressions.Regex]::IsMatch(
        $Action,
        $regexPattern,
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
}

function Test-RolePermissionAllowsAction {
    param(
        $Permission,
        [string]$Action
    )

    $allowedPatterns = @($Permission.actions)
    $deniedPatterns = @($Permission.notActions)

    $isAllowed = $false
    foreach ($pattern in $allowedPatterns) {
        if (Test-ActionMatchesPattern -Action $Action -Pattern ([string]$pattern)) {
            $isAllowed = $true
            break
        }
    }

    if (-not $isAllowed) {
        return $false
    }

    foreach ($pattern in $deniedPatterns) {
        if (Test-ActionMatchesPattern -Action $Action -Pattern ([string]$pattern)) {
            return $false
        }
    }

    return $true
}

function Get-RoleDefinitionJoinActionCheck {
    param(
        [string]$RoleDefinitionId,
        [string]$Action
    )

    $result = [PSCustomObject]@{
        Resolved = $false
        Allows = $false
        RoleName = $RoleDefinitionId
    }

    try {
        $roleDefinitionJson = Invoke-ExternalCommand -CommandParts @(
            "az", "role", "definition", "show",
            "--id", $RoleDefinitionId,
            "-o", "json"
        ) -CaptureOutput

        $roleDefinition = $roleDefinitionJson | ConvertFrom-Json
        if ($roleDefinition.roleName) {
            $result.RoleName = [string]$roleDefinition.roleName
        }

        $result.Resolved = $true
        foreach ($permission in @($roleDefinition.permissions)) {
            if (Test-RolePermissionAllowsAction -Permission $permission -Action $Action) {
                $result.Allows = $true
                break
            }
        }
    } catch {
        Write-Warning "Unable to resolve role definition '$RoleDefinitionId' while evaluating linked-scope permission preflight."
    }

    return $result
}

function Invoke-AzureCommandWithLinkedScopeGuidance {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$CommandParts,
        [string]$DisplayText,
        [string]$ManagedEnvironmentScope,
        [string]$PrincipalObjectId
    )

    try {
        # Capture command output so linked-scope authorization details are available in exception text.
        $commandOutput = Invoke-ExternalCommand -CommandParts $CommandParts -CaptureOutput -DisplayText $DisplayText
        if ($null -ne $commandOutput) {
            $rendered = ($commandOutput | Out-String).Trim()
            if (-not [string]::IsNullOrWhiteSpace($rendered)) {
                Write-Host $rendered
            }
        }
    } catch {
        $errorText = $_.Exception.Message
        $hasLinkedAuthorizationError =
            ($errorText -match "LinkedAuthorizationFailed") -or
            ($errorText -match "Microsoft\.App/managedEnvironments/join/action")

        if ($hasLinkedAuthorizationError) {
            $scopeHint = if ([string]::IsNullOrWhiteSpace($ManagedEnvironmentScope)) {
                "<managed-environment-resource-id>"
            } else {
                $ManagedEnvironmentScope
            }

            $principalHint = if ([string]::IsNullOrWhiteSpace($PrincipalObjectId)) {
                "<service-principal-object-id>"
            } else {
                $PrincipalObjectId
            }

            throw (
                "$errorText`n`n" +
                "Missing linked-scope permission on the Container Apps managed environment.`n" +
                "Grant the deploying identity a role on this scope, then rerun:`n" +
                "  az role assignment create --assignee-object-id $principalHint --role Contributor --scope $scopeHint`n`n" +
                "If role assignment changes are restricted, ask a subscription owner to run the command above."
            )
        }

        throw
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

function Resolve-IntSetting {
    param(
        [string]$EnvName,
        [int]$DefaultValue
    )

    $rawValue = [Environment]::GetEnvironmentVariable($EnvName)
    if ([string]::IsNullOrWhiteSpace($rawValue)) {
        return $DefaultValue
    }

    $parsed = 0
    if ([int]::TryParse($rawValue, [ref]$parsed)) {
        return $parsed
    }

    Write-Warning "Invalid integer for $EnvName='$rawValue'. Falling back to $DefaultValue."
    return $DefaultValue
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
$jobParallelism = Resolve-IntSetting -EnvName "AZURE_JOB_PARALLELISM" -DefaultValue $Parallelism
$jobReplicaCompletionCount = Resolve-IntSetting -EnvName "AZURE_JOB_REPLICA_COMPLETION_COUNT" -DefaultValue $ReplicaCompletionCount
$jobReplicaRetryLimit = Resolve-IntSetting -EnvName "AZURE_JOB_REPLICA_RETRY_LIMIT" -DefaultValue $ReplicaRetryLimit
$jobReplicaTimeout = Resolve-IntSetting -EnvName "AZURE_JOB_REPLICA_TIMEOUT" -DefaultValue $ReplicaTimeout

$resolvedSubscriptionId = $envMap["AZURE_SUBSCRIPTION_ID"]
if ([string]::IsNullOrWhiteSpace($resolvedSubscriptionId)) {
    try {
        $subscriptionIdOutput = Invoke-ExternalCommand -CommandParts @("az", "account", "show", "--query", "id", "-o", "tsv") -CaptureOutput
        $resolvedSubscriptionId = ($subscriptionIdOutput | Out-String).Trim()
    } catch {
        $resolvedSubscriptionId = ""
    }
}

$jobExists = $false
$existingJob = $null
try {
    $existingJobJson = Invoke-ExternalCommand -CommandParts @(
        "az", "containerapp", "job", "show",
        "-n", $JobName,
        "-g", $ResourceGroup
    ) -CaptureOutput
    $existingJob = $existingJobJson | ConvertFrom-Json
    $jobExists = $true
} catch {
    $jobExists = $false
}

$effectiveEnvironmentResourceId = $EnvironmentResourceId
if ($jobExists -and $existingJob -and -not [string]::IsNullOrWhiteSpace($existingJob.properties.environmentId)) {
    $effectiveEnvironmentResourceId = $existingJob.properties.environmentId
}

if ([string]::IsNullOrWhiteSpace($RegistryName) -and $jobExists -and $existingJob) {
    $existingRegistryServer = [string]$existingJob.properties.configuration.registries[0].server
    if (-not [string]::IsNullOrWhiteSpace($existingRegistryServer)) {
        if ($existingRegistryServer.EndsWith(".azurecr.io")) {
            $RegistryName = $existingRegistryServer.Substring(0, $existingRegistryServer.Length - ".azurecr.io".Length)
        } else {
            $RegistryName = $existingRegistryServer
        }
    }
}

if ([string]::IsNullOrWhiteSpace($RegistryName)) {
    try {
        $acrListJson = Invoke-ExternalCommand -CommandParts @(
            "az", "acr", "list",
            "-g", $ResourceGroup,
            "--query", "[].name",
            "-o", "json"
        ) -CaptureOutput

        $acrNames = @($acrListJson | ConvertFrom-Json)
        if ($acrNames.Count -eq 1) {
            $RegistryName = [string]$acrNames[0]
        } elseif ($acrNames.Count -gt 1) {
            $registryList = ($acrNames | ForEach-Object { [string]$_ }) -join ", "
            throw "RegistryName is required. Multiple ACR registries were found in resource group '$ResourceGroup': $registryList. Set AZURE_ACR_NAME or pass -RegistryName explicitly."
        }
    } catch {
        if ($_.Exception.Message -match "Multiple ACR registries were found") {
            throw
        }
        Write-Warning "Could not auto-discover ACR registry name from resource group '$ResourceGroup'."
    }
}

$deployingPrincipalObjectId = Get-CurrentPrincipalObjectId
$requiredLinkedAction = "Microsoft.App/managedEnvironments/join/action"
$strictLinkedScopePreflight = if ([string]::IsNullOrWhiteSpace($env:AZURE_STRICT_LINKED_SCOPE_PREFLIGHT)) {
    $true
} else {
    [System.Convert]::ToBoolean($env:AZURE_STRICT_LINKED_SCOPE_PREFLIGHT)
}
$buildPushOnly = if ([string]::IsNullOrWhiteSpace($env:AZURE_BUILD_PUSH_ONLY)) {
    $false
} else {
    [System.Convert]::ToBoolean($env:AZURE_BUILD_PUSH_ONLY)
}

if ([string]::IsNullOrWhiteSpace($RegistryName)) {
    throw "RegistryName is required. Set AZURE_ACR_NAME in config/.env or pass -RegistryName explicitly."
}

if (-not $buildPushOnly -and [string]::IsNullOrWhiteSpace($effectiveEnvironmentResourceId)) {
    throw "EnvironmentResourceId is required. Set AZURE_ENVIRONMENT_RESOURCE_ID in config/.env or pass -EnvironmentResourceId explicitly."
}

if (-not $buildPushOnly -and -not $jobExists -and -not $AllowCreate) {
    throw "Target job '$JobName' not found in resource group '$ResourceGroup'. Refusing to create a new job unless -AllowCreate is set to true."
}

if (-not $buildPushOnly -and -not [string]::IsNullOrWhiteSpace($deployingPrincipalObjectId) -and -not [string]::IsNullOrWhiteSpace($effectiveEnvironmentResourceId)) {
    try {
        $assignmentJson = $null
        try {
            $assignmentJson = Invoke-ExternalCommand -CommandParts @(
                "az", "role", "assignment", "list",
                "--assignee-object-id", $deployingPrincipalObjectId,
                "--scope", $effectiveEnvironmentResourceId,
                "--include-inherited",
                "--all",
                "-o", "json"
            ) -CaptureOutput
        } catch {
            if ($_.Exception.Message -match "group or scope are not required when --all is used") {
                # Some az cli builds reject --scope with --all. Retry with scoped listing only.
                $assignmentJson = Invoke-ExternalCommand -CommandParts @(
                    "az", "role", "assignment", "list",
                    "--assignee-object-id", $deployingPrincipalObjectId,
                    "--scope", $effectiveEnvironmentResourceId,
                    "--include-inherited",
                    "-o", "json"
                ) -CaptureOutput
            } else {
                throw
            }
        }

        $assignments = @($assignmentJson | ConvertFrom-Json)
        if (-not $assignments -or $assignments.Count -eq 0) {
            throw (
                "No role assignments found for deploying principal '$deployingPrincipalObjectId' on managed environment scope '$effectiveEnvironmentResourceId'.`n" +
                "Grant access, then rerun:`n" +
                "  az role assignment create --assignee-object-id $deployingPrincipalObjectId --role Contributor --scope $effectiveEnvironmentResourceId"
            )
        }

        $roleDefinitionIds = @(
            $assignments |
                ForEach-Object { [string]$_.roleDefinitionId } |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
                Sort-Object -Unique
        )

        if (-not $roleDefinitionIds -or $roleDefinitionIds.Count -eq 0) {
            throw "Role assignment preflight could not resolve role definition IDs for principal '$deployingPrincipalObjectId' on '$effectiveEnvironmentResourceId'."
        }

        $roleChecks = @()
        foreach ($roleDefinitionId in $roleDefinitionIds) {
            $roleChecks += Get-RoleDefinitionJoinActionCheck -RoleDefinitionId $roleDefinitionId -Action $requiredLinkedAction
        }

        $resolvedRoleChecks = @($roleChecks | Where-Object { $_.Resolved })
        $unresolvedRoleChecks = @($roleChecks | Where-Object { -not $_.Resolved })
        $rolesGrantingJoin = @(
            $resolvedRoleChecks |
                Where-Object { $_.Allows } |
                ForEach-Object { $_.RoleName } |
                Sort-Object -Unique
        )

        if ($resolvedRoleChecks.Count -gt 0 -and $rolesGrantingJoin.Count -eq 0) {
            $resolvedRoleNames = @(
                $resolvedRoleChecks |
                    ForEach-Object { $_.RoleName } |
                    Sort-Object -Unique
            )
            $resolvedRoleText = if ($resolvedRoleNames.Count -gt 0) {
                $resolvedRoleNames -join ", "
            } else {
                "<resolved roles>"
            }

            throw (
                "Deploying principal '$deployingPrincipalObjectId' has linked-scope assignments on '$effectiveEnvironmentResourceId' ($resolvedRoleText), but none grant '$requiredLinkedAction'.`n" +
                "Grant access, then rerun:`n" +
                "  az role assignment create --assignee-object-id $deployingPrincipalObjectId --role Contributor --scope $effectiveEnvironmentResourceId"
            )
        }

        if ($rolesGrantingJoin.Count -gt 0) {
            Write-Host "RBAC preflight passed for linked action '$requiredLinkedAction' on '$effectiveEnvironmentResourceId'."
        } elseif ($unresolvedRoleChecks.Count -gt 0) {
            $unresolvedMessage = "Could not fully verify linked action '$requiredLinkedAction' because one or more role definitions could not be resolved."
            if ($strictLinkedScopePreflight) {
                throw (
                    "$unresolvedMessage`n" +
                    "Set AZURE_STRICT_LINKED_SCOPE_PREFLIGHT=false only if you intentionally want best-effort preflight."
                )
            }
            Write-Warning "$unresolvedMessage Deployment will continue and may fail later with LinkedAuthorizationFailed."
        }
    } catch {
        if (
            ($_.Exception.Message -match "No role assignments found for deploying principal") -or
            ($_.Exception.Message -match "none grant 'Microsoft\.App/managedEnvironments/join/action'")
        ) {
            throw
        }

        $isRbacReadDenied =
            ($_.Exception.Message -match "Microsoft\.Authorization/roleAssignments/read") -or
            ($_.Exception.Message -match "Microsoft\.Authorization/roleDefinitions/read")

        if ($isRbacReadDenied) {
            Write-Warning (
                "RBAC preflight introspection is unavailable because the deploying identity cannot read role assignments/definitions on '$effectiveEnvironmentResourceId'. " +
                "Continuing with write-probe preflight (job secret/registry operations), which will still fail-fast on missing linked-scope permission."
            )
        } elseif ($strictLinkedScopePreflight) {
            throw (
                "Could not verify managed environment RBAC preflight. " +
                "Set AZURE_STRICT_LINKED_SCOPE_PREFLIGHT=false only if you intentionally want best-effort preflight.`n" +
                $_.Exception.Message
            )
        } else {
            Write-Warning "Could not verify managed environment RBAC preflight. Deployment will continue and may fail later with LinkedAuthorizationFailed."
        }
    }
}

$loginServer = "$RegistryName.azurecr.io"
$fullImage = "$loginServer/$ImageName"

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
Add-KeyValueIfPresent -Target $secretArgs -Key "webhook-secret" -Value $envMap["WEBHOOK_SECRET"]
Add-KeyValueIfPresent -Target $secretArgs -Key "encryption-key" -Value $envMap["ENCRYPTION_KEY"]

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
Add-KeyValueIfPresent -Target $envArgs -Key "WEBHOOK_URL" -Value $envMap["WEBHOOK_URL"]
Add-KeyValueIfPresent -Target $envArgs -Key "BACKEND_URL" -Value $envMap["BACKEND_URL"]
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
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_JOB_NAME" -Value $JobName
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_JOB_NAME_PRIMARY" -Value $envMap["AZURE_JOB_NAME_PRIMARY"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_JOB_NAME_SECONDARY" -Value $envMap["AZURE_JOB_NAME_SECONDARY"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_JOB_LABEL_PRIMARY" -Value $envMap["AZURE_JOB_LABEL_PRIMARY"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_JOB_LABEL_SECONDARY" -Value $envMap["AZURE_JOB_LABEL_SECONDARY"]
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_RESOURCE_GROUP" -Value $ResourceGroup
Add-KeyValueIfPresent -Target $envArgs -Key "AZURE_SUBSCRIPTION_ID" -Value $resolvedSubscriptionId
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
$envArgs.Add("ENCRYPTION_KEY=secretref:encryption-key")
$envArgs.Add("WEBHOOK_SECRET=secretref:webhook-secret")
$envArgs.Add("YOUTUBE_CLIENT_SECRET_B64=secretref:yt-client-b64")
$envArgs.Add("YOUTUBE_TOKEN_B64=secretref:yt-token-b64")
$envArgs.Add("TELEGRAM_BOT_TOKEN=secretref:telegram-bot-token")
$envArgs.Add("TELEGRAM_ALLOWED_CHAT_ID=secretref:telegram-allowed-chat-id")
$envArgs.Add("RUN_COUNT=1")

if ($jobExists -and -not $buildPushOnly) {
    # Preflight write operations before image build so RBAC issues fail fast.
    Invoke-AzureCommandWithLinkedScopeGuidance -CommandParts (
        @(
            "az", "containerapp", "job", "secret", "set",
            "-n", $JobName,
            "-g", $ResourceGroup,
            "--secrets"
        ) + $secretArgs
    ) -DisplayText "az containerapp job secret set -n $JobName -g $ResourceGroup --secrets <hidden>" -ManagedEnvironmentScope $effectiveEnvironmentResourceId -PrincipalObjectId $deployingPrincipalObjectId

    Invoke-AzureCommandWithLinkedScopeGuidance -CommandParts @(
        "az", "containerapp", "job", "registry", "set",
        "-n", $JobName,
        "-g", $ResourceGroup,
        "--server", $loginServer,
        "--username", $acrUser,
        "--password", $acrPass
    ) -DisplayText "az containerapp job registry set -n $JobName -g $ResourceGroup --server $loginServer --username <hidden> --password <hidden>" -ManagedEnvironmentScope $effectiveEnvironmentResourceId -PrincipalObjectId $deployingPrincipalObjectId
}

try {
    Invoke-ExternalCommand -CommandParts @("az", "acr", "build", "-r", $RegistryName, "-t", $ImageName, ".")
} catch {
    Write-Host "ACR build with streaming logs failed. Retrying with --no-logs..."
    try {
        Invoke-ExternalCommand -CommandParts @("az", "acr", "build", "-r", $RegistryName, "-t", $ImageName, ".", "--no-logs")
    } catch {
        Write-Host "ACR Tasks unavailable or failed. Falling back to local Docker build and push."

        try {
            Invoke-ExternalCommand -CommandParts @("docker", "version") | Out-Null
        } catch {
            throw "ACR build failed and Docker daemon is unavailable. Start Docker Desktop or resolve ACR build errors, then retry."
        }

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
}

if ($buildPushOnly) {
    Write-Warning "AZURE_BUILD_PUSH_ONLY=true: skipping Container Apps Job secret/registry/update operations."
    Write-Host "Build and push completed only."
    Write-Host "Image: $fullImage"
    Write-Host "Tag: $normalizedImageTag"
    exit 0
}

if ($jobExists) {

    Invoke-AzureCommandWithLinkedScopeGuidance -CommandParts (
        @(
            "az", "containerapp", "job", "update",
            "-n", $JobName,
            "-g", $ResourceGroup,
            "--image", $fullImage,
            "--cpu", $jobCpu,
            "--memory", $jobMemory,
            "--parallelism", "$jobParallelism",
            "--replica-completion-count", "$jobReplicaCompletionCount",
            "--replica-retry-limit", "$jobReplicaRetryLimit",
            "--replica-timeout", "$jobReplicaTimeout",
            "--set-env-vars"
        ) + $envArgs
    ) -DisplayText "az containerapp job update -n $JobName -g $ResourceGroup --image $fullImage --cpu $jobCpu --memory $jobMemory --parallelism $jobParallelism --replica-completion-count $jobReplicaCompletionCount --replica-retry-limit $jobReplicaRetryLimit --replica-timeout $jobReplicaTimeout --set-env-vars <configured>" -ManagedEnvironmentScope $effectiveEnvironmentResourceId -PrincipalObjectId $deployingPrincipalObjectId
} else {
    Invoke-AzureCommandWithLinkedScopeGuidance -CommandParts (
        @(
            "az", "containerapp", "job", "create",
            "-n", $JobName,
            "-g", $ResourceGroup,
            "--environment", $effectiveEnvironmentResourceId,
            "--trigger-type", "Manual",
            "--image", $fullImage,
            "--cpu", $jobCpu,
            "--memory", $jobMemory,
            "--parallelism", "$jobParallelism",
            "--replica-completion-count", "$jobReplicaCompletionCount",
            "--replica-retry-limit", "$jobReplicaRetryLimit",
            "--replica-timeout", "$jobReplicaTimeout",
            "--registry-server", $loginServer,
            "--registry-username", $acrUser,
            "--registry-password", $acrPass,
            "--secrets"
        ) + $secretArgs + @("--env-vars") + $envArgs
    ) -DisplayText "az containerapp job create -n $JobName -g $ResourceGroup --environment $effectiveEnvironmentResourceId --trigger-type Manual --image $fullImage --cpu $jobCpu --memory $jobMemory --parallelism $jobParallelism --replica-completion-count $jobReplicaCompletionCount --replica-retry-limit $jobReplicaRetryLimit --replica-timeout $jobReplicaTimeout --registry-server $loginServer --registry-username <hidden> --registry-password <hidden> --secrets <hidden> --env-vars <configured>" -ManagedEnvironmentScope $effectiveEnvironmentResourceId -PrincipalObjectId $deployingPrincipalObjectId
}

Write-Host "Azure job ready: $JobName"
Write-Host "Image: $fullImage"
Write-Host "Tag: $normalizedImageTag"
