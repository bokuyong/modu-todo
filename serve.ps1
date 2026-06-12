# serve.ps1 — 의존성 없는 로컬 정적 서버 (PowerShell 내장 기능만 사용)
# 사용법: powershell -ExecutionPolicy Bypass -File serve.ps1 [포트]
param([int]$Port = 8741)

$root = $PSScriptRoot
$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ics'  = 'text/calendar; charset=utf-8'
  '.ico'  = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "서버 실행 중: http://localhost:$Port/  (중지: Ctrl+C)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $reqPath = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      if ($reqPath -eq '/') { $reqPath = '/index.html' }
      $file = Join-Path $root ($reqPath -replace '/', '\').TrimStart('\')

      # 디렉터리 탈출 방지
      $fullFile = [System.IO.Path]::GetFullPath($file)
      if (-not $fullFile.StartsWith($root) -or -not (Test-Path $fullFile -PathType Leaf)) {
        $ctx.Response.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      } else {
        $ext = [System.IO.Path]::GetExtension($fullFile).ToLower()
        $ct = $mime[$ext]
        if (-not $ct) { $ct = 'application/octet-stream' }
        $ctx.Response.ContentType = $ct
        $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
        $bytes = [System.IO.File]::ReadAllBytes($fullFile)
      }
      if ($ctx.Request.HttpMethod -eq 'HEAD') {
        # HEAD 요청에는 본문을 쓰면 안 됨
        $ctx.Response.ContentLength64 = $bytes.Length
      } else {
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      # 요청 하나의 오류가 서버 전체를 죽이지 않도록 격리
      Write-Host "요청 처리 오류: $($_.Exception.Message)"
    } finally {
      try { $ctx.Response.OutputStream.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
