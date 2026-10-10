[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$TaskName = '중독백과 자동 업로드',
    [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
    [string]$StartTime = '14:10',
    [string]$BasePython = 'C:\Users\My\AppData\Local\Programs\Python\Python312\python.exe',
    [switch]$SkipDependencyInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$PipelineRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$VideoRoot = Join-Path $PipelineRoot 'video_v2'
$SourceRunnerPath = Join-Path $PipelineRoot 'run_youtube_publisher.ps1'
$LockPath = Join-Path $PipelineRoot 'publisher-requirements.lock.txt'
$PublisherRoot = Join-Path (Split-Path $PipelineRoot -Parent) '.publisher-runtime'
$DataRoot = Join-Path $PublisherRoot 'data'
$ReleaseRoot = Join-Path $PublisherRoot 'release'
$InstalledRunnerPath = Join-Path $DataRoot 'run_youtube_publisher.ps1'
$RuntimeRoot = Join-Path $PublisherRoot 'venv'
$LegacyDataRoot = Join-Path $env:LOCALAPPDATA 'AddictedNews\youtube-publisher'
$RuntimePython = Join-Path $RuntimeRoot 'Scripts\python.exe'
$LogRoot = Join-Path $DataRoot 'logs'
$DbEnvPath = Join-Path $DataRoot 'publisher-db.env'
$ManifestPath = Join-Path $DataRoot 'release-manifest.json'
$PowerShellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$CurrentUser = $CurrentIdentity.Name
$CurrentSid = $CurrentIdentity.User
$SystemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$AdministratorsSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Test-PrivateAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$RequireInheritance
    )

    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) { return $false }
    try {
        $ownerSid = $acl.GetOwner(
            [Security.Principal.SecurityIdentifier]
        ).Value
    }
    catch {
        return $false
    }
    if ($ownerSid -ne $CurrentSid.Value) { return $false }
    $allowed = @($CurrentSid.Value, $SystemSid.Value, $AdministratorsSid.Value)
    $seen = @{}
    foreach ($rule in @($acl.Access)) {
        try {
            $sid = $rule.IdentityReference.Translate(
                [Security.Principal.SecurityIdentifier]
            ).Value
        }
        catch {
            return $false
        }
        $fullControl = [int][Security.AccessControl.FileSystemRights]::FullControl
        $hasFullControl = (([int]$rule.FileSystemRights -band $fullControl) -eq $fullControl)
        $isAllowedIdentity = ($allowed -contains $sid)
        $hasRequiredInheritance = $true
        if ($RequireInheritance) {
            $requiredInheritance = [int][Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
            $hasRequiredInheritance = (([int]$rule.InheritanceFlags -band $requiredInheritance) -eq $requiredInheritance)
        }
        if (($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) -or (-not $isAllowedIdentity) -or (-not $hasFullControl) -or (-not $hasRequiredInheritance)) {
            return $false
        }
        $seen[$sid] = $true
    }
    foreach ($sid in $allowed) {
        if (-not $seen.ContainsKey($sid)) { return $false }
    }
    return $true
}

function Set-PrivateDirectoryAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (Test-PrivateAcl -Path $Path -RequireInheritance) { return }

    $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($CurrentSid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($CurrentSid, $SystemSid, $AdministratorsSid)) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $sid,
            [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            $propagation,
            $allow
        )
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Set-PrivateFileAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (Test-PrivateAcl -Path $Path) { return }

    $allow = [Security.AccessControl.AccessControlType]::Allow
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetOwner($CurrentSid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($CurrentSid, $SystemSid, $AdministratorsSid)) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule(
            $sid,
            [Security.AccessControl.FileSystemRights]::FullControl,
            $allow
        )
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Move-RuntimeFile {
    param([Parameter(Mandatory = $true)][string]$Name)

    $source = Join-Path $PipelineRoot $Name
    $legacySource = Join-Path $LegacyDataRoot $Name
    $destination = Join-Path $DataRoot $Name
    foreach ($candidate in @($source, $legacySource)) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            $candidateHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash
            $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
            if ($candidateHash -ne $destinationHash) {
                throw "런타임 파일이 두 위치에 있고 내용이 다릅니다: $Name"
            }
            Remove-Item -LiteralPath $candidate -Force
        }
        else {
            Move-Item -LiteralPath $candidate -Destination $destination
        }
    }
    if (Test-Path -LiteralPath $destination -PathType Leaf) {
        Set-PrivateFileAcl -Path $destination
    }
}

function Write-PublisherDbEnv {
    $backendEnv = Join-Path (Split-Path $PipelineRoot -Parent) 'backend\.env'
    if (-not (Test-Path -LiteralPath $backendEnv -PathType Leaf)) {
        throw "DB 설정 원본을 찾을 수 없습니다: $backendEnv"
    }
    $required = @('DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME')
    $values = @{}
    foreach ($raw in Get-Content -LiteralPath $backendEnv -Encoding UTF8) {
        $line = $raw.Trim()
        if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) { continue }
        $index = $line.IndexOf('=')
        $name = $line.Substring(0, $index).Trim()
        if ($required -contains $name) {
            $values[$name] = $line.Substring($index + 1).Trim()
        }
    }
    $missing = @($required | Where-Object { -not $values.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($values[$_]) })
    if ($missing.Count -gt 0) {
        throw "게시 전용 DB 설정에 필요한 키가 없습니다: $($missing -join ', ')"
    }
    $content = ($required | ForEach-Object { "$_=$($values[$_])" }) -join [Environment]::NewLine
    [IO.File]::WriteAllText($DbEnvPath, $content + [Environment]::NewLine, $Utf8NoBom)
    Set-PrivateFileAcl -Path $DbEnvPath
}

function Write-ReleaseManifest {
    $relativeFiles = @(
        'upload_youtube.py',
        'publisher_state.py',
        'lib\fetch.py',
        'lib\logutil.py',
        'existing_uploads.audit.json'
    )
    $files = foreach ($relative in $relativeFiles) {
        $path = Join-Path $ReleaseRoot $relative
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "릴리스 고정 대상 파일이 없습니다: $relative"
        }
        [ordered]@{
            path = $relative
            sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    $manifest = [ordered]@{
        schema_version = 1
        created_at = [DateTimeOffset]::Now.ToString('o')
        pipeline_root = $PipelineRoot
        release_root = $ReleaseRoot
        files = @($files)
    } | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText($ManifestPath, $manifest + [Environment]::NewLine, $Utf8NoBom)
    Set-PrivateFileAcl -Path $ManifestPath
}

function Install-ReleaseFiles {
    $relativeFiles = @(
        'upload_youtube.py',
        'publisher_state.py',
        'lib\fetch.py',
        'lib\logutil.py',
        'existing_uploads.audit.json'
    )
    foreach ($relative in $relativeFiles) {
        $source = Join-Path $PipelineRoot $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "릴리스 원본 파일이 없습니다: $relative"
        }
        $destination = Join-Path $ReleaseRoot $relative
        $destinationDirectory = Split-Path $destination -Parent
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
        Set-PrivateFileAcl -Path $destination
    }
}

foreach ($requiredPath in @($SourceRunnerPath, $LockPath, $BasePython, $PowerShellPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "필수 파일을 찾을 수 없습니다: $requiredPath"
    }
}
if (-not (Test-Path -LiteralPath $VideoRoot -PathType Container)) {
    throw "정식 영상 원본 디렉터리를 찾을 수 없습니다: $VideoRoot"
}

if ($PSCmdlet.ShouldProcess($DataRoot, '보호된 게시 런타임 디렉터리 준비')) {
    New-Item -ItemType Directory -Path $PublisherRoot -Force | Out-Null
    Set-PrivateDirectoryAcl -Path $PublisherRoot
    New-Item -ItemType Directory -Path $DataRoot -Force | Out-Null
    Set-PrivateDirectoryAcl -Path $DataRoot
    New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
    Set-PrivateDirectoryAcl -Path $LogRoot
    New-Item -ItemType Directory -Path $ReleaseRoot -Force | Out-Null
    Set-PrivateDirectoryAcl -Path $ReleaseRoot

    foreach ($name in @('client_secret.json', 'token.json', 'upload_state.json', 'upload_state.json.bak')) {
        Move-RuntimeFile -Name $name
    }
    foreach ($requiredName in @('client_secret.json', 'token.json', 'upload_state.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $DataRoot $requiredName) -PathType Leaf)) {
            throw "보호된 런타임 파일이 없습니다: $requiredName"
        }
    }
    Write-PublisherDbEnv
    Copy-Item -LiteralPath $SourceRunnerPath -Destination $InstalledRunnerPath -Force
    Set-PrivateFileAcl -Path $InstalledRunnerPath
    Install-ReleaseFiles

    # Unpublished source files are the canonical upload inputs. Protect the
    # directory itself; ordinary child files inherit these restricted rules.
    Set-PrivateDirectoryAcl -Path $VideoRoot
}

if (-not (Test-Path -LiteralPath $RuntimePython -PathType Leaf)) {
    if ($PSCmdlet.ShouldProcess($RuntimeRoot, '전용 Python 가상환경 생성')) {
        & $BasePython -m venv $RuntimeRoot
        if ($LASTEXITCODE -ne 0) { throw "전용 Python 가상환경 생성 실패: $LASTEXITCODE" }
    }
}

if (-not $SkipDependencyInstall) {
    if ($PSCmdlet.ShouldProcess($RuntimeRoot, '고정된 YouTube 게시 의존성 설치')) {
        & $RuntimePython -m pip install --disable-pip-version-check --no-input -r $LockPath
        if ($LASTEXITCODE -ne 0) { throw "Python 의존성 설치 실패: $LASTEXITCODE" }
    }
}

& $RuntimePython -c "import googleapiclient, google_auth_oauthlib, psycopg2; print('publisher_dependencies=ok')"
if ($LASTEXITCODE -ne 0) { throw '전용 Python 의존성 검증 실패' }

if ($PSCmdlet.ShouldProcess($ManifestPath, '검토된 게시 코드 해시 고정')) {
    Write-ReleaseManifest
}

& $PowerShellPath -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $InstalledRunnerPath -PipelineRoot $PipelineRoot -DryRun
if ($LASTEXITCODE -ne 0) { throw "게시 실행기 DRY-RUN 실패: $LASTEXITCODE" }

& $PowerShellPath -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $InstalledRunnerPath -PipelineRoot $PipelineRoot -Preflight
if ($LASTEXITCODE -ne 0) { throw "게시 실행기 읽기 전용 사전 점검 실패: $LASTEXITCODE" }

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $existingTask) {
    $backupPath = Join-Path $LogRoot ("scheduled-task-backup-{0}.xml" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $xml = Export-ScheduledTask -TaskName $TaskName
    [IO.File]::WriteAllText($backupPath, $xml, $Utf8NoBom)
    Set-PrivateFileAcl -Path $backupPath
}

$start = [DateTime]::ParseExact($StartTime, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$actionArguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -PipelineRoot "{1}"' -f $InstalledRunnerPath, $PipelineRoot
$action = New-ScheduledTaskAction `
    -Execute $PowerShellPath `
    -Argument $actionArguments `
    -WorkingDirectory $DataRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $start
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -WakeToRun `
    -RunOnlyIfNetworkAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 30) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 6) `
    -Compatibility Win8
$principal = New-ScheduledTaskPrincipal `
    -UserId $CurrentUser `
    -LogonType Interactive `
    -RunLevel Limited
$task = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Codex 앱과 무관하게 중독백과 영상을 매일 비공개 업로드한다. 절전 깨우기·누락 실행·중복 방지·당일 YouTube 제한 중단을 적용한다.'

if ($PSCmdlet.ShouldProcess($TaskName, 'Windows 예약 작업 등록/갱신')) {
    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
}

$registered = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
[pscustomobject]@{
    TaskName = $registered.TaskName
    State = $registered.State
    UserId = $registered.Principal.UserId
    LogonType = $registered.Principal.LogonType
    NextRunTime = $info.NextRunTime
    WakeToRun = $registered.Settings.WakeToRun
    StartWhenAvailable = $registered.Settings.StartWhenAvailable
    MultipleInstances = $registered.Settings.MultipleInstances
    RuntimePython = $RuntimePython
    SecureDataRoot = $DataRoot
    Runner = $InstalledRunnerPath
}
