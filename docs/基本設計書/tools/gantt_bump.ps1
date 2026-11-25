# ガントチャートのファイル名の番号を1つ上げる（ガントチャート(アプリオリ)1113.xlsx → ガントチャート(アプリオリ)1114.xlsx）
# ガントチャートを更新するごとに1回だけ、更新（gantt_apply.ps1）がすべて終わったあとに実行する（2026-11-20 決定）。
#
# 使い方（リポジトリのルートで。ガントチャートを Excel で閉じてから）:
#   powershell -ExecutionPolicy Bypass -File "docs/基本設計書/tools/gantt_bump.ps1"
$ErrorActionPreference = "Stop"
$doc = (Resolve-Path "$PSScriptRoot\..").Path
$found = @(Get-ChildItem -LiteralPath $doc -Filter "ガントチャート*.xlsx" | Where-Object { $_.Name -notlike '~$*' })
if ($found.Count -ne 1) { throw "ガントチャートの xlsx が1つに決まりません: $($found.Name -join ', ')" }
$f = $found[0]
if ($f.Name -notmatch '^(.*?)(\d+)\.xlsx$') { throw "ファイル名の最後に番号がありません: $($f.Name)" }
$num = $Matches[2]
$next = ([int64]$num + 1).ToString().PadLeft($num.Length, '0')
$newName = "$($Matches[1])$next.xlsx"
if (Test-Path -LiteralPath (Join-Path $doc $newName)) { throw "同じ名前のファイルがあります: $newName" }
if (Get-Process EXCEL -ErrorAction SilentlyContinue) {
  $lock = Join-Path $doc ('~$' + $f.Name)
  if (Test-Path -LiteralPath $lock) { throw "ガントチャートが Excel で開かれています。閉じてからもう一度実行してください: $($f.Name)" }
}
Rename-Item -LiteralPath $f.FullName -NewName $newName
# 前のファイル名のロックファイル（Excel が残したもの）は、Excel が動いていなければ消す
$oldLock = Join-Path $doc ('~$' + $f.Name)
if ((Test-Path -LiteralPath $oldLock) -and -not (Get-Process EXCEL -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath $oldLock -Force }
Write-Host "ファイル名を変えました: $($f.Name) → $newName"
