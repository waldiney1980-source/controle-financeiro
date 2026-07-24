# =============================================================
# serve.ps1 — Servidor local para o FinControl AI (sem Python/Node)
# Uso: clique com o botão direito > "Executar com PowerShell"
#      ou rode:  powershell -ExecutionPolicy Bypass -File serve.ps1
# Depois abra no navegador: http://localhost:5173
# =============================================================
$root   = Join-Path $PSScriptRoot "web"
$prefix = "http://localhost:5173/"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch {
  Write-Host "Nao foi possivel abrir a porta 5173. Feche outro servidor e tente de novo." -ForegroundColor Red
  exit 1
}
Write-Host "FinControl AI rodando em $prefix  (Ctrl+C para parar)" -ForegroundColor Green
Start-Process $prefix  # abre o navegador padrao

$mime = @{
  ".html"="text/html; charset=utf-8"; ".css"="text/css"; ".js"="application/javascript";
  ".json"="application/json"; ".webmanifest"="application/manifest+json"; ".png"="image/png"; ".svg"="image/svg+xml"
}

while ($listener.IsListening) {
  try {
    $ctx  = $listener.GetContext()
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.LocalPath).TrimStart("/")
    if ([string]::IsNullOrEmpty($path)) { $path = "index.html" }
    $full = Join-Path $root $path
    if (Test-Path $full -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  } catch { }
}
