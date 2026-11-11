# 仕様書.md と図から基本設計書 docx を作る（手順は ../基本設計書の作成手順.md の「5. docx を作る」）
#
#   1. 図（.puml）を PNG にする（Word で SVG が表示できないときの代わりの画像として docx に一緒に入れる）
#   2. build_docx.py で手本の docx の書式を使った下書きを作る
#   3. Word で開いて目次・ページ番号を更新し、docx として保存する
#   4. check_docx.py で、できた docx の表紙・改訂履歴・目次・表と図の数を確かめる（NG があれば失敗で終わる）
#
# PDF は作らない（Word の PDF 書き出しは、powershell -File からでも外からでも戻ってこないことがあった）。
# 見た目（崩れ・改ページ）は、できた docx を Word で開いて目で確かめる。
#
# 使い方（リポジトリのルートで）:
#   powershell -ExecutionPolicy Bypass -File "docs/基本設計書/tools/build_docx.ps1" -Rev 03 -RevNote "改訂の概要"
#
# 必要なもの: Java（tools/plantuml.jar）、Python（py ランチャー）、Microsoft Word（365 版。SVG の表示に対応しているもの）
param(
  [Parameter(Mandatory = $true)][string]$Rev,       # 改訂履歴に足す版数（例 03。tools/改訂履歴.tsv に足す。表紙の文書番号の「(01)」にも使う）
  [Parameter(Mandatory = $true)][string]$RevNote,   # 改訂履歴に足す改訂の概要
  [string]$Date = (Get-Date -Format "yyyy/MM/dd"),  # 表紙と改訂履歴の日付
  [string]$Out = "",                                # 出力先（省略時は 作成ファイル/…_仕様書から作成.docx）
  [switch]$SkipPng,                                 # PNG を作り直さない（ふつうは不要。図が変わったときだけ自動で作り直す）
  [switch]$ForcePng                                 # 図が変わっていなくても PNG を作り直す
)
$ErrorActionPreference = "Stop"

$root = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$doc  = Join-Path $root "docs\基本設計書"
$template = Join-Path $doc "作成ファイル\04_2026_卒研_基本設計書(R4SA_アプリオリ).docx"
if ($Out -eq "") { $Out = Join-Path $doc "作成ファイル\04_2026_卒研_基本設計書(R4SA_アプリオリ)_仕様書から作成.docx" }
# 出力先を Word で開いたままだと最後の保存で失敗するので、先に確かめて止める
if (Test-Path -LiteralPath $Out) {
  try { $fs = [System.IO.File]::Open($Out, 'Open', 'ReadWrite', 'None'); $fs.Close() }
  catch { throw "出力先の docx がほかのプログラム（Word など）で開かれています。閉じてから実行してください: $Out" }
}
$work = Join-Path $env:TEMP "toniq_build_docx"
$png  = Join-Path $work "png"
$draft = Join-Path $work ("draft_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".docx")  # 実行ごとに名前を変える（前の Word が残っていても書ける）
New-Item -ItemType Directory -Force $png | Out-Null

# 1. PNG（大きな図が切れないよう上限を広げ、144dpi で出す）
#    PNG がない・いちばん新しい .puml（スタイルの共通ファイルを含む）が いちばん古い PNG より新しいときだけ作り直す
$pngs = @(Get-ChildItem $png -Filter *.png -ErrorAction SilentlyContinue)
$newestPuml = (Get-ChildItem (Join-Path $doc "図") -Recurse -Filter *.puml | Measure-Object LastWriteTime -Maximum).Maximum
$oldestPng = if ($pngs.Count) { ($pngs | Measure-Object LastWriteTime -Minimum).Minimum } else { $null }
$needPng = $ForcePng -or -not $pngs.Count -or (-not $SkipPng -and $newestPuml -gt $oldestPng)
if ($needPng) {
  "PNG を作成中..."
  Push-Location $root
  try {
    & java "-DPLANTUML_LIMIT_SIZE=16384" -jar tools/plantuml.jar -tpng "-Sdpi=144" -charset UTF-8 -o $png "docs/基本設計書/図/**/*.puml"
    if ($LASTEXITCODE -ne 0) { throw "PlantUML の変換に失敗しました" }
  } finally { Pop-Location }
} else {
  "PNG は図が変わっていないので作り直さない"
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
$d = $null
try {
  $d = $word.Documents.Open($draft, $false, $false, $false)
  $d.Repaginate()
  foreach ($t in $d.TablesOfContents) { $t.Update() }
  $d.Repaginate()
  foreach ($t in $d.TablesOfContents) { $t.UpdatePageNumbers() }
  "ページ数: " + $d.ComputeStatistics(2)
  $d.SaveAs2($Out, 16)
} finally {
  # 途中で失敗しても文書を閉じてから Word を終える（開いたまま残ると、次の実行で下書きを書けない）
  if ($d) { try { $d.Close(0) } catch {} }
  $word.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
Remove-Item -LiteralPath $draft -ErrorAction SilentlyContinue
"完成: $Out"

# 4. できた docx を確かめる（結果は UTF-8 のファイルを経由して出す。端末の文字化け対策）
"確認中..."
$check = Join-Path $work "check.txt"
& py (Join-Path $PSScriptRoot "check_docx.py") $Out (Join-Path $doc "仕様書.md") $Rev $Date --out $check | Out-Null
$checkCode = $LASTEXITCODE
Get-Content -LiteralPath $check -Encoding UTF8
if ($checkCode -ne 0) { throw "check_docx.py で NG がありました（上の [NG] の行）" }
