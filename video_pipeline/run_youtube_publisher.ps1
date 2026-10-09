[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Preflight,
    [string]$PipelineRoot = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$ExpectedCatalogCount = 172
$TargetChannelId = 'UCNLL7-k2it9ngjN9BUma4Og'
$TargetPlaylistId = 'PLOkpb7PUCsbk'
if ([string]::IsNullOrWhiteSpace($PipelineRoot)) {
    $PipelineRoot = $PSScriptRoot
}
$PipelineRoot = [IO.Path]::GetFullPath($PipelineRoot)
$PublisherRoot = Join-Path (Split-Path $PipelineRoot -Parent) '.publisher-runtime'
$DataRoot = Join-Path $PublisherRoot 'data'
$ReleaseRoot = Join-Path $PublisherRoot 'release'
$UploaderPath = Join-Path $ReleaseRoot 'upload_youtube.py'
$StatePath = Join-Path $DataRoot 'upload_state.json'
$DbEnvPath = Join-Path $DataRoot 'publisher-db.env'
$ManifestPath = Join-Path $DataRoot 'release-manifest.json'
$RuntimeRoot = Join-Path $PublisherRoot 'venv'
$PythonPath = Join-Path $RuntimeRoot 'Scripts\python.exe'
$LogRoot = Join-Path $DataRoot 'logs'
$StatusPath = Join-Path $LogRoot 'status.json'
$LogPath = Join-Path $LogRoot ("publisher-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
$RunSummaryPath = Join-Path $LogRoot 'last_run_summary.json'
$RunId = [guid]::NewGuid().ToString()
$KoreaTimeZone = [TimeZoneInfo]::FindSystemTimeZoneById('Korea Standard Time')
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null

function Get-KoreaNow {
    return [TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $KoreaTimeZone)
}

function Write-PublisherLog {
    # Python prints blank separator lines; a Mandatory [string] rejects '' and
    # the resulting binding error used to abort the whole run (10-07/10-08).
    param([Parameter(Mandatory = $true)][AllowEmptyString()][AllowNull()][string]$Message)

    if ([string]::IsNullOrWhiteSpace($Message)) { return }
    $safeMessage = $Message
    $safeMessage = $safeMessage -replace '(?i)\bBearer\s+\S+', 'Bearer [REDACTED]'
    $safeMessage = $safeMessage -replace '(?i)\bya29\.[A-Za-z0-9._~-]+', '[REDACTED_GOOGLE_TOKEN]'
    $safeMessage = $safeMessage -replace '(?i)(postgres(?:ql)?://[^:\s/]+:)[^@\s]+@', '$1[REDACTED]@'
    $safeMessage = $safeMessage -replace '(?i)\b(access_token|refresh_token|client_secret|password|authorization|jwt)\b(?:\s*["'']?\s*[:=]|\s+)\s*.*$', '$1=[REDACTED]'
    $line = '[{0}] {1}' -f ((Get-KoreaNow).ToString('yyyy-MM-dd HH:mm:ss zzz')), $safeMessage
    [IO.File]::AppendAllText($LogPath, $line + [Environment]::NewLine, $Utf8NoBom)
    Write-Output $line
}

function Assert-ReleaseManifest {
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        throw "고정 릴리스 manifest가 없습니다: $ManifestPath"
    }
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $rootPrefix = $ReleaseRoot.TrimEnd('\') + '\'
    $expectedFiles = @{}
    foreach ($entry in @($manifest.files)) {
        $relativePath = ([string]$entry.path).Replace('/', '\')
        $relativeKey = $relativePath.ToLowerInvariant()
        if ($expectedFiles.ContainsKey($relativeKey)) {
            throw "manifest에 중복 경로가 있습니다: $relativePath"
        }
        $expectedFiles[$relativeKey] = $true
        $candidate = [IO.Path]::GetFullPath((Join-Path $ReleaseRoot $relativePath))
        if (-not $candidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "manifest 경로가 보호된 릴리스 밖을 가리킵니다: $relativePath"
        }
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw "고정 릴리스 파일이 없습니다: $relativePath"
        }
        $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne ([string]$entry.sha256).ToLowerInvariant()) {
            throw "고정 릴리스 해시 불일치: $relativePath. 설치기를 다시 실행해 검토된 버전을 고정하세요."
        }
    }
    foreach ($file in Get-ChildItem -LiteralPath $ReleaseRoot -Recurse -File) {
        $relativePath = $file.FullName.Substring($rootPrefix.Length)
        if (-not $expectedFiles.ContainsKey($relativePath.ToLowerInvariant())) {
            throw "보호된 릴리스에 manifest 밖 파일이 있습니다: $relativePath"
        }
    }
}

function Read-PublisherState {
    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
        throw "업로드 상태 파일이 없습니다: $StatePath"
    }
    return Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-OptionalProperty {
    param(
        [Parameter(Mandatory = $true)]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $InputObject) { return $null }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-StateSummary {
    param([Parameter(Mandatory = $true)]$State)

    $records = @($State.PSObject.Properties | Where-Object { $_.Name -ne '_meta' })
    $completed = @($records | Where-Object {
        $videoId = Get-OptionalProperty -InputObject $_.Value -Name 'video_id'
        $null -ne $videoId -and -not [string]::IsNullOrWhiteSpace([string]$videoId)
    }).Count
    return [pscustomobject]@{
        completed = $completed
        remaining = [Math]::Max(0, $ExpectedCatalogCount - $completed)
    }
}

function Get-TodayLimitRecord {
    param([Parameter(Mandatory = $true)]$State)

    $today = (Get-KoreaNow).Date
    foreach ($property in $State.PSObject.Properties) {
        if ($property.Name -eq '_meta') { continue }
        $errorRecord = Get-OptionalProperty -InputObject $property.Value -Name 'last_error'
        if ($null -eq $errorRecord) { continue }
        $stage = Get-OptionalProperty -InputObject $errorRecord -Name 'stage'
        $atValue = Get-OptionalProperty -InputObject $errorRecord -Name 'at'
        if ($stage -ne 'youtube_limit' -or [string]::IsNullOrWhiteSpace([string]$atValue)) {
            continue
        }
        try {
            $at = [DateTimeOffset]::Parse(
                [string]$atValue,
                [Globalization.CultureInfo]::InvariantCulture
            )
            if ([TimeZoneInfo]::ConvertTime($at, $KoreaTimeZone).Date -eq $today) {
                return [pscustomobject]@{ term = $property.Name; at = [string]$atValue }
            }
        }
        catch {
            throw "YouTube 제한 시각을 해석할 수 없습니다: $($property.Name)"
        }
    }
    return $null
}

function Read-RunSummary {
    # The uploader writes per-run conflicts/duplicates/limit here; only a file
    # carrying this run's id is trusted so a stale summary is never reported.
    if (-not (Test-Path -LiteralPath $RunSummaryPath -PathType Leaf)) { return $null }
    try {
        $summary = Get-Content -LiteralPath $RunSummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        return $null
    }
    if ((Get-OptionalProperty -InputObject $summary -Name 'run_id') -ne $RunId) { return $null }
    return $summary
}

function Save-RunnerStatus {
    param(
        [Parameter(Mandatory = $true)][string]$Result,
        [Parameter(Mandatory = $true)]$Summary,
        [int]$ExitCode = 0,
        [AllowEmptyString()][string]$Detail = '',
        [int]$Uploaded = 0,
        $RunSummary = $null,
        [AllowEmptyString()][string]$Limit = ''
    )

    $conflicts = @()
    $duplicates = 0
    if ($null -ne $RunSummary) {
        $conflicts = @(Get-OptionalProperty -InputObject $RunSummary -Name 'conflicts' | Where-Object { $null -ne $_ })
        $duplicateValue = Get-OptionalProperty -InputObject $RunSummary -Name 'duplicates'
        if ($null -ne $duplicateValue) { $duplicates = [int]$duplicateValue }
        $summaryLimit = Get-OptionalProperty -InputObject $RunSummary -Name 'limit'
        if ([string]::IsNullOrWhiteSpace($Limit) -and -not [string]::IsNullOrWhiteSpace([string]$summaryLimit)) {
            $Limit = [string]$summaryLimit
        }
    }
    $payload = [ordered]@{
        schema_version = 1
        checked_at = (Get-KoreaNow).ToString('o')
        result = $Result
        completed = $Summary.completed
        remaining = $Summary.remaining
        uploaded = $Uploaded
        exit_code = $ExitCode
        detail = $Detail
        conflicts = $conflicts
        duplicates = $duplicates
        limit = $(if ([string]::IsNullOrWhiteSpace($Limit)) { $null } else { $Limit })
        target_channel_id = $TargetChannelId
        target_playlist_id = $TargetPlaylistId
    }
    $json = $payload | ConvertTo-Json -Depth 4
    $tempPath = "$StatusPath.tmp"
    [IO.File]::WriteAllText($tempPath, $json + [Environment]::NewLine, $Utf8NoBom)
    Move-Item -LiteralPath $tempPath -Destination $StatusPath -Force
}

try {
    if ($DryRun -and $Preflight) {
        throw '-DryRun과 -Preflight는 동시에 사용할 수 없습니다.'
    }
    if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
        throw "전용 Python 런타임이 없습니다. install_youtube_publisher_task.ps1을 먼저 실행하세요: $PythonPath"
    }
    if (-not (Test-Path -LiteralPath $UploaderPath -PathType Leaf)) {
        throw "YouTube 업로더가 없습니다: $UploaderPath"
    }
    if (-not (Test-Path -LiteralPath $DbEnvPath -PathType Leaf)) {
        throw "게시 전용 DB 환경 파일이 없습니다: $DbEnvPath"
    }

    Get-ChildItem -LiteralPath $LogRoot -Filter 'publisher-*.log' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddDays(-30) } |
        Remove-Item -Force

    Assert-ReleaseManifest

    $initialState = Read-PublisherState
    $initialSummary = Get-StateSummary -State $initialState

    if ($initialSummary.remaining -eq 0) {
        Write-PublisherLog "전체 $ExpectedCatalogCount 편이 이미 기록되어 종료합니다."
        Save-RunnerStatus -Result 'complete' -Summary $initialSummary
        exit 0
    }

    if (-not $DryRun -and -not $Preflight) {
        $todayLimit = Get-TodayLimitRecord -State $initialState
        if ($null -ne $todayLimit) {
            Write-PublisherLog "오늘 YouTube 업로드 제한이 이미 기록되어 재시도하지 않습니다: $($todayLimit.term)"
            Save-RunnerStatus -Result 'skipped_youtube_limit' -Summary $initialSummary -Detail $todayLimit.term -Limit $todayLimit.term
            exit 0
        }
    }

    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    $env:PYTHONDONTWRITEBYTECODE = '1'
    $env:YOUTUBE_PUBLISHER_DATA_DIR = $DataRoot
    $env:YOUTUBE_PUBLISHER_NONINTERACTIVE = '1'
    $env:YOUTUBE_PIPELINE_ROOT = $PipelineRoot
    $env:PUBLISHER_DB_ENV = $DbEnvPath
    $env:YOUTUBE_PUBLISHER_RUN_SUMMARY = $RunSummaryPath
    $env:YOUTUBE_PUBLISHER_RUN_ID = $RunId
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $OutputEncoding = [Console]::OutputEncoding
    Set-Location -LiteralPath $PipelineRoot

    $arguments = @('-I', '-B', $UploaderPath)
    if ($DryRun) {
        $arguments += @('--dry-run', '--all')
        Write-PublisherLog "DRY-RUN 시작: 기록 $($initialSummary.completed)/$ExpectedCatalogCount, 남음 $($initialSummary.remaining)"
    }
    elseif ($Preflight) {
        $arguments += @(
            '--reconcile-only',
            '--channel-id', $TargetChannelId,
            '--playlist-id', $TargetPlaylistId
        )
        Write-PublisherLog "읽기 전용 사전 점검 시작: 기록 $($initialSummary.completed)/$ExpectedCatalogCount, 남음 $($initialSummary.remaining)"
    }
    else {
        $arguments += @(
            '--all',
            '--channel-id', $TargetChannelId,
            '--playlist-id', $TargetPlaylistId
        )
        Write-PublisherLog "비공개 업로드 시작: 기록 $($initialSummary.completed)/$ExpectedCatalogCount, 남음 $($initialSummary.remaining)"
    }

    # Windows PowerShell 5.1 turns native stderr into ErrorRecord objects.
    # With the script-wide Stop preference, an ordinary Python warning would
    # otherwise abort this pipeline before we can inspect the process exit code
    # and persisted upload state.
    $previousErrorActionPreference = $ErrorActionPreference
    $lastOutputLine = ''
    try {
        $ErrorActionPreference = 'Continue'
        & $PythonPath @arguments 2>&1 | ForEach-Object {
            $text = if ($null -eq $_) { '' } else { [string]$_ }
            if (-not [string]::IsNullOrWhiteSpace($text)) {
                $lastOutputLine = $text.Trim()
                Write-PublisherLog $text
            }
        }
        $publisherExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($null -eq $publisherExitCode) { $publisherExitCode = 1 }

    $finalState = Read-PublisherState
    $finalSummary = Get-StateSummary -State $finalState
    $uploaded = $finalSummary.completed - $initialSummary.completed
    $runSummary = Read-RunSummary
    $failureDetail = ''
    if ($null -ne $runSummary) {
        $failureDetail = [string](Get-OptionalProperty -InputObject $runSummary -Name 'detail')
        # Reconcile adoptions also raise the recorded count; report only the
        # uploads this run actually performed.
        $reportedUploads = Get-OptionalProperty -InputObject $runSummary -Name 'uploaded'
        if ($null -ne $reportedUploads) { $uploaded = [int]$reportedUploads }
    }
    if ([string]::IsNullOrWhiteSpace($failureDetail)) { $failureDetail = $lastOutputLine }

    if ($DryRun) {
        if ($publisherExitCode -ne 0) {
            Save-RunnerStatus -Result 'dry_run_failed' -Summary $finalSummary -ExitCode $publisherExitCode -Detail $failureDetail -RunSummary $runSummary
            exit $publisherExitCode
        }
        Write-PublisherLog "DRY-RUN 완료: 상태 변경 없음, 남음 $($finalSummary.remaining)"
        Save-RunnerStatus -Result 'dry_run_ok' -Summary $finalSummary -RunSummary $runSummary
        exit 0
    }

    if ($Preflight) {
        if ($publisherExitCode -ne 0) {
            Save-RunnerStatus -Result 'preflight_failed' -Summary $finalSummary -ExitCode $publisherExitCode -Detail $failureDetail -RunSummary $runSummary
            exit $publisherExitCode
        }
        Write-PublisherLog "읽기 전용 사전 점검 완료: 채널·재생목록·DB·원격 상태 확인, 남음 $($finalSummary.remaining)"
        Save-RunnerStatus -Result 'preflight_ok' -Summary $finalSummary -Uploaded $uploaded -RunSummary $runSummary
        exit 0
    }

    $limitAfterRun = Get-TodayLimitRecord -State $finalState
    if ($null -ne $limitAfterRun) {
        Write-PublisherLog "YouTube 업로드 제한으로 정상 중단: 이번 $uploaded 편, 누적 $($finalSummary.completed), 남음 $($finalSummary.remaining)"
        Save-RunnerStatus -Result 'youtube_limit' -Summary $finalSummary -Detail $limitAfterRun.term -Uploaded $uploaded -RunSummary $runSummary -Limit $limitAfterRun.term
        exit 0
    }

    if ($publisherExitCode -ne 0) {
        Write-PublisherLog "업로더 실패: 종료 코드 $publisherExitCode, 이번 기록 증가 $uploaded 편"
        Save-RunnerStatus -Result 'failed' -Summary $finalSummary -ExitCode $publisherExitCode -Detail $failureDetail -Uploaded $uploaded -RunSummary $runSummary
        exit $publisherExitCode
    }

    $result = if ($finalSummary.remaining -eq 0) { 'complete' } else { 'uploaded' }
    Write-PublisherLog "업로드 실행 완료: 이번 $uploaded 편, 누적 $($finalSummary.completed), 남음 $($finalSummary.remaining)"
    Save-RunnerStatus -Result $result -Summary $finalSummary -Uploaded $uploaded -RunSummary $runSummary
    exit 0
}
catch {
    $message = $_.Exception.Message
    try {
        Write-PublisherLog "치명적 오류: $message"
        $state = Read-PublisherState
        Save-RunnerStatus -Result 'failed' -Summary (Get-StateSummary -State $state) -ExitCode 1 -Detail $message
    }
    catch {
        Write-Error $message
    }
    exit 1
}
