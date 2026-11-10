# 仕様書.md と図から基本設計書 docx を作る（手順は ../基本設計書の作成手順.md の「5. docx を作る」）
#
#   1. 図（.puml）を PNG にする（Word で SVG が表示できないときの代わりの画像として docx に一緒に入れる）
#   2. build_docx.py で手本の docx の書式を使った下書きを作る
#   3. Word で開いて目次・ページ番号を更新し、docx として保存する
#
# PDF はこのスクリプトでは作らない（powershell -File から Word の PDF 書き出しを呼ぶと戻ってこなかった）。
# 確認用の PDF は、できた docx を Word で開いて書き出す（手順書の 5-1）。
#
# 使い方（リポジトリのルートで）:
#   powershell -ExecutionPolicy Bypass -File "docs/基本設計書/tools/build_docx.ps1" -Rev 03 -RevNote "改訂の概要"
#
# 必要なもの: Java（tools/plantuml.jar）、Python（py ランチャー）、Microsoft Word（365 版。SVG の表示に対応しているもの）
param(
  [Parameter(Mandatory = $true)][string]$Rev,       # 改訂履歴に足す版数（例 03）
  [Parameter(Mandatory = $true)][string]$RevNote,   # 改訂履歴に足す改訂の概要
  [string]$Date = (Get-Date -Format "yyyy/MM/dd"),  # 表紙と改訂履歴の日付
  [string]$Out = "",                                # 出力先（省略時は 作成ファイル/…_仕様書から作成.docx）
  [switch]$SkipPng                                  # 図を変えていないときは PNG の作り直しを省く
)
$ErrorActionPreference = "Stop"

$root = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$doc  = Join-Path $root "docs\基本設計書"
$template = Join-Path $doc "作成ファイル\04_2026_卒研_基本設計書(R4SA_アプリオリ).docx"
if ($Out -eq "") { $Out = Join-Path $doc "作成ファイル\04_2026_卒研_基本設計書(R4SA_アプリオリ)_仕様書から作成.docx" }
$work = Join-Path $env:TEMP "toniq_build_docx"
$png  = Join-Path $work "png"
$draft = Join-Path $work "draft.docx"
New-Item -ItemType Directory -Force $png | Out-Null

# 1. PNG（大きな図が切れないよう上限を広げ、144dpi で出す）
if (-not $SkipPng -or -not (Get-ChildItem $png -Filter *.png -ErrorAction SilentlyContinue)) {
  "PNG を作成中..."
  Push-Location $root
  try {
    & java "-DPLANTUML_LIMIT_SIZE=16384" -jar tools/plantuml.jar -tpng "-Sdpi=144" -charset UTF-8 -o $png "docs/基本設計書/図/**/*.puml"
    if ($LASTEXITCODE -ne 0) { throw "PlantUML の変換に失敗しました" }
  } finally { Pop-Location }
}
"PNG: " + (Get-ChildItem $png -Filter *.png).Count + " 枚"

# 2. 下書き
"下書きを作成中..."
$env:PYTHONIOENCODING = "utf-8"
& py (Join-Path $PSScriptRoot "build_docx.py") (Join-Path $doc "仕様書.md") $template $png (Join-Path $doc "図") $draft $Date $Rev $RevNote
if ($LASTEXITCODE -ne 0) { throw "build_docx.py が失敗しました" }

# 3. Word で目次・ページ番号を更新して保存（16 = docx 形式）
"Word で目次を更新中..."
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $d = $word.Documents.Open($draft, $false, $false, $false)
  $d.Repaginate()
  foreach ($t in $d.TablesOfContents) { $t.Update() }
  $d.Repaginate()
  foreach ($t in $d.TablesOfContents) { $t.UpdatePageNumbers() }
  "ページ数: " + $d.ComputeStatistics(2)
  $d.SaveAs2($Out, 16)
  $d.Close($false)
} finally {
  $word.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
"完成: $Out"
