# ガントチャート（xlsx）に計画（JSON）の変更を Excel で当てる（手順は .claude/skills/update-gantt/SKILL.md）
#
# 書式を崩さないよう、xlsx の中身は直接いじらず Excel 自身に操作させる：
#   - 行の追加は、節の最後の行を写して（数式・書式・罫線・高さごと）その下に挿入し、B〜F 列の値だけ書き換える。
#     条件付き書式の範囲・シート「2027」の参照・名前の範囲は Excel がずらす。
#   - 値の書き換え（set）と文字の置き換え（replace）は、値の入ったセルだけを書き換える（書式はそのまま）。
#
# 計画の JSON（UTF-8）:
#   {
#     "replace": [ { "from": "西園", "to": "西薗", "columns": "B:F" } ],          # シート 2026 の定数のセルだけ
#     "set":     [ { "row": 360, "col": "B", "value": "7-01.BPM選択機能 （BpmSelection）" } ],   # 今のファイルの行番号
#     "show":    [ { "rows": "136:142" } ],   # 隠した雛形の行（○○）を使うとき。set で値を書いてから表示する
#     "insert":  [ { "after": 80, "rows": [ { "B": "2-56.拍子選択機能", "C": "根井", "D": 1, "E": "2026-11-09", "F": "2026-11-10" } ] } ],
#     "delete":  [ 61, 80 ]   # 仕様書から外した機能などの行。シート「2027」は触らない（その行を参照している行は #REF! になる）
#   }
#   set → show → replace → insert → delete の順に当てる。行番号はどれも今のファイル（当てる前）の行番号で書く。
#   insert は下の節から順に挿入するので互いにずれず、delete は insert で増えた分をずらしてから下の行から消す。
#
# 使い方（リポジトリのルートで。ガントチャートを Excel で閉じてから）:
#   powershell -ExecutionPolicy Bypass -File "docs/基本設計書/tools/gantt_apply.ps1" -Plan <計画.json>
#   -Out <別の xlsx> を付けると、元のファイルを写したものに当てる（試すとき用。元のファイルは変えない）
param(
  [Parameter(Mandatory = $true)][string]$Plan,
  [string]$Xlsx = "",
  [string]$Out = "",
  [string]$Sheet = "2026"
)
$ErrorActionPreference = "Stop"
$doc = (Resolve-Path "$PSScriptRoot\..").Path
if (-not $Xlsx) {
  $found = @(Get-ChildItem -LiteralPath $doc -Filter "ガントチャート*.xlsx" | Where-Object { $_.Name -notlike '~$*' })
  if ($found.Count -ne 1) { throw "ガントチャートの xlsx が1つに決まりません: $($found.Name -join ', ')" }
  $Xlsx = $found[0].FullName
}
$Xlsx = (Resolve-Path -LiteralPath $Xlsx).Path
$lock = Join-Path (Split-Path $Xlsx) ('~$' + (Split-Path $Xlsx -Leaf))
if ($Out) {
  Copy-Item -LiteralPath $Xlsx -Destination $Out -Force
  $target = (Resolve-Path -LiteralPath $Out).Path
} else {
  # ロックファイル（~$…）は Excel が異常終了すると残るので、Excel が動いているときだけ止める
  if ((Test-Path -LiteralPath $lock) -and (Get-Process EXCEL -ErrorAction SilentlyContinue)) {
    throw "ガントチャートが Excel で開かれています。閉じてからもう一度実行してください: $Xlsx"
  }
  $target = $Xlsx
}
$planObj = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json

function To-Serial($v) {
  if ($v -is [string] -and $v -match '^\d{4}-\d{2}-\d{2}$') { return ([datetime]::ParseExact($v, 'yyyy-MM-dd', $null)).ToOADate() }
  if ($v -is [string]) { return $v }
  return [double]$v   # 進捗状況（1 = 100%）など。Int32 のままだと Excel に渡せない
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$xl.ScreenUpdating = $false
$wb = $null
try {
  $wb = $xl.Workbooks.Open($target, 0, $false)
  $ws = $wb.Worksheets.Item($Sheet)

  # 1. 値の書き換え（今の行番号のまま）
  foreach ($s in @($planObj.set)) {
    if (-not $s) { continue }
    $cell = $ws.Range("$($s.col)$($s.row)")
    if ($cell.HasFormula) { throw "数式のセルは書き換えません: $($s.col)$($s.row)" }
    $val = To-Serial $s.value
    if ($val -is [double]) { $cell.Formula = $val.ToString([Globalization.CultureInfo]::InvariantCulture) } else { $cell.Value2 = $val }
  }

  # 1b. 隠した雛形の行を表示する（グループ化を外してから表示。上の見えている行と同じ状態にする）
  foreach ($sh in @($planObj.show)) {
    if (-not $sh) { continue }
    $rng = $ws.Range("$($sh.rows)").EntireRow
    while ([int]$rng.Rows.Item(1).OutlineLevel -gt 1) { [void]$rng.Ungroup() }
    $rng.Hidden = $false
    Write-Host "表示した行: $($sh.rows)"
  }

  # 2. 文字の置き換え（定数のセルだけ。数式・書式は触らない）
  foreach ($r in @($planObj.replace)) {
    if (-not $r) { continue }
    $cols = if ($r.columns) { $r.columns } else { "B:F" }
    $n = 0
    $c1, $c2 = $cols.Split(":")
    $last = $ws.UsedRange.Row + $ws.UsedRange.Rows.Count - 1
    foreach ($cell in $ws.Range("${c1}1:$c2$last").Cells) {
      if ($cell.HasFormula) { continue }
      $v = $cell.Value2
      if ($v -is [string] -and $v.Contains($r.from)) { $cell.Value2 = $v.Replace($r.from, $r.to); $n++ }
    }
    Write-Host "置き換え「$($r.from)」→「$($r.to)」: $n セル"
  }

  # 3. 行の追加（下の節から。節の最後の行を写して、その下に挿入する）
  $inserts = @($planObj.insert | Where-Object { $_ }) | Sort-Object { [int]$_.after } -Descending
  foreach ($ins in $inserts) {
    $after = [int]$ins.after
    $rows = @($ins.rows)
    if ($rows.Count -eq 0) { continue }
    $src = $ws.Range("${after}:${after}")
    $dest = $ws.Range("$($after + 1):$($after + $rows.Count)")
    [void]$src.Copy()
    [void]$dest.Insert(-4121)   # xlShiftDown。写した行（数式・書式・高さ）で挿入する
    for ($i = 0; $i -lt $rows.Count; $i++) {
      $r = $after + 1 + $i
      foreach ($col in @("B", "C", "D", "E", "F")) {
        $v = $rows[$i].$col
        if ($null -eq $v) { continue }
        $val = To-Serial $v
        # 数は文字にして Formula で入れる（PowerShell から Value2 に数を入れると型の変換で失敗するため）
        if ($val -is [double]) { $ws.Range("$col$r").Formula = $val.ToString([Globalization.CultureInfo]::InvariantCulture) }
        else { $ws.Range("$col$r").Value2 = $val }
      }
    }
    Write-Host "$after 行の下に $($rows.Count) 行を追加: $(($rows | ForEach-Object { $_.B }) -join ' / ')"
  }

  # 4. 行の削除（insert で増えた行の分をずらし、下の行から消す）
  $dels = @($planObj.delete | Where-Object { $_ } | ForEach-Object {
      $r = [int]$_
      $shift = 0
      foreach ($ins in $inserts) { if ([int]$ins.after -lt $r) { $shift += @($ins.rows).Count } }
      $r + $shift
    }) | Sort-Object -Descending -Unique
  if ($dels.Count -gt 0) {
    # シート「2027」などほかのシートには触らない（2026-11-20 決定）。このシートの消す行を数式で写している行は #REF! になるので、行番号を知らせるだけ
    foreach ($other in $wb.Worksheets) {
      if ($other.Name -eq $Sheet) { continue }
      $lastO = $other.UsedRange.Row + $other.UsedRange.Rows.Count - 1
      $hits = @()
      for ($r = 1; $r -le $lastO; $r++) {
        $f = [string]$other.Range("B$r").Formula
        if ($f -match "^='?$([regex]::Escape($Sheet))'?!\`$?B\`$?(\d+)$" -and $dels -contains [int]$Matches[1]) { $hits += $r }
      }
      if ($hits.Count) { Write-Host "お知らせ: シート「$($other.Name)」の $($hits -join ', ') 行は消す行を参照しているので #REF! になります（このシートは直さない）" }
    }
    foreach ($r in $dels) {
      $b = $ws.Range("B$r").Value2
      [void]$ws.Range("${r}:${r}").Delete(-4162)
      Write-Host "削除: $r 行 $b"
    }
  }

  $wb.Save()
  Write-Host "保存しました: $target"
} finally {
  if ($wb) { $wb.Close($false) }
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
