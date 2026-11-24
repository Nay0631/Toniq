# docx を作る前の確認（/build-design-doc の 0〜2 をまとめたもの）
#
# 必要なもの・出力先が開かれていないか・仕様書が origin/main に追いついているか・付録C の「要：」・
# 5.2 と 6.2 の対応・未実装の機能と build_docx.py の文・開発のテスト・確認用のものが載っていないか・
# 次の版数と改訂の概要の材料を、OK / NG で数行に出す。
# NG が1つでもあれば終了コード 1。結果は UTF-8 のファイル（--out）にも書く（Windows の端末の文字化け対策）。
#
# 使い方（リポジトリのルートで）:
#   py docs/基本設計書/tools/preflight.py [--no-fetch] [--out 結果.txt]
import argparse, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOC = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(DOC))
SPEC = os.path.join(DOC, '仕様書.md')
GUIDE = os.path.join(DOC, '基本設計書の作成手順.md')
TEMPLATE = os.path.join(DOC, '作成ファイル', '04_2026_卒研_基本設計書(R4SA_アプリオリ).docx')
# 作る docx のファイル名の先頭の2桁は改訂の版数（2026-11-19 決定。手本の docx の「04_」はそのまま）
def out_docx(rev):
    return os.path.join(DOC, '作成ファイル', f'{rev}_2026_卒研_基本設計書(R4SA_アプリオリ)_仕様書から作成.docx')
REV_FILE = os.path.join(HERE, '改訂履歴.tsv')
BUILD_PY = os.path.join(HERE, 'build_docx.py')
CODE_PATHS = ['src', 'index.html', 'electron', 'public', 'package.json']
# システムの開発のためのテスト・確認に作ったものは基本設計書に載せない（2026-11-19 決定）。付録B より前にこの語があれば NG
DEV_ONLY = ['テスト中の機能', 'メロディ評価', 'メロディの評価', '自動チェック', '一括計測', '開発用',
            'npm run quality', 'npm run mix:measure', 'npm test', 'npm run lint', 'npm run typecheck',
            'QualityCheck', 'QualityBatch', 'RatingScreen', 'MelodyRatings']
# 基本設計書は完成したシステムとして書く（2026-11-20 決定）。付録B より前にこれがあれば NG
STYLE_WORDS = ['以前', '旧名', '廃止', '（追加）', 'lidless', '曲の基本設定システム',
               # 作成途中・まだ決まっていないことを表す語も書かない（画面に「テスト中」と出ていても書かない。2026-11-23 決定）
               'テスト中', '暫定', '試作', '開発中', '作成中', '今後', '将来']
# 改訂履歴（tools/改訂履歴.tsv）には、削除・廃止したことと、今の文書にない名前を書かない（2026-11-23 決定）
REV_WORDS = ['削除', '廃止', '置き換え', '改名', 'lidless', 'Toniqシンセ', 'Toniq シンセ']
STYLE_MARKS = re.compile('[\U0001F000-\U0001FFFF☀-➿⬀-⯿⌀-⏿️■◀▶↻▷↺↶↷⇄⟲‹⋮←↑↓]')

ap = argparse.ArgumentParser()
ap.add_argument('--no-fetch', action='store_true', help='git fetch origin を省く')
ap.add_argument('--out', help='結果を UTF-8 で書くファイル')
args = ap.parse_args()

lines, ng = [], 0
def report(ok, label, detail=''):
    global ng
    if ok is False:
        ng += 1
    mark = {True: 'OK', False: 'NG', None: '--'}[ok]
    lines.append(f'[{mark}] {label}' + (f'：{detail}' if detail else ''))

def git(*a):
    r = subprocess.run(['git', *a], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    return r.returncode, r.stdout.strip()

# ---------- 必要なもの ----------
missing = []
if not shutil.which('java'):
    missing.append('Java（winget install EclipseAdoptium.Temurin.21.JRE）')
if not shutil.which('node'):
    missing.append('Node.js（ロバストネス図の線の文を置き直す robustness_labels.mjs に使う。winget install OpenJS.NodeJS.LTS）')
if not os.path.isdir(r'C:\Program Files\Microsoft Office'):
    missing.append('Word（Microsoft 365）')
if not os.path.exists(TEMPLATE):
    missing.append('手本の docx（git restore で戻す。消さない）')
report(not missing, '必要なもの（Java・Python・Node.js・Word・手本の docx）', '、'.join(missing) + ' がない' if missing else '')

# ---------- 前回の版数と次の版数 ----------
revs = []
if os.path.exists(REV_FILE):
    for l in open(REV_FILE, encoding='utf-8').read().splitlines():
        if l.strip() and not l.startswith('#'):
            revs.append(l.split('\t', 2))
last = revs[-1] if revs else ['01', '2026/10/19', '初版発行']
nxt = f'{int(last[0]) + 1:02d}'
# 改訂履歴には、開発のテスト・確認用の機能（完成したシステムに含めないもの）の追加・削除を書かない（2026-11-23 決定）
rev_dev = [f'{r[0]}（{w}）' for r in revs for w in DEV_ONLY[:6] if w in r[2]]
report(not rev_dev, '改訂履歴に開発のテスト・確認用の機能が書かれていない',
       '、'.join(rev_dev) + '。tools/改訂履歴.tsv の概要から外す' if rev_dev else '')
rev_style = [f'{r[0]}（{w}）' for r in revs for w in REV_WORDS if w in r[2]]
report(not rev_style, '改訂履歴に削除・廃止したことと、今の文書にない名前が書かれていない',
       '、'.join(rev_style) + '。tools/改訂履歴.tsv の概要を今の名前・番号で書き直す' if rev_style else '')

# ---------- 出力先が開かれていないか ----------
OUT_DOCX = out_docx(nxt)
locked = False
if os.path.exists(OUT_DOCX):
    try:
        open(OUT_DOCX, 'r+b').close()
    except OSError:
        locked = True
report(not locked, f'出力先の docx（{os.path.basename(OUT_DOCX)}）が閉じている', 'Word などで開かれている。閉じてから作る' if locked else '')

# ---------- 仕様書の基準と origin/main ----------
spec = open(SPEC, encoding='utf-8').read()
spec_lines = spec.splitlines()
m = re.search(r'基準のコード\*\*：`main` のコミット `(\w+)`', spec)
base = m.group(1) if m else None
if not args.no_fetch:
    git('fetch', 'origin')
_, head = git('rev-parse', '--short', 'origin/main')
if not base:
    report(False, '仕様書の基準のコミット', '仕様書.md の先頭に「基準のコード」が見つからない')
elif git('rev-parse', '--short', base)[1] == head:
    report(True, '仕様書の基準 = origin/main', head)
else:
    rc, _ = git('diff', '--quiet', base, 'origin/main', '--', *CODE_PATHS)
    if rc == 0:
        report(True, '仕様書の基準と origin/main', f'{base} → {head}。コードの変更なし（docs だけ）')
    else:
        _, stat = git('diff', '--shortstat', base, 'origin/main', '--', *CODE_PATHS)
        report(False, '仕様書の基準と origin/main', f'{base} → {head}。コードの変更あり（{stat}）。先に /update-spec を行うか聞く')

# ---------- 付録C の「要：」 ----------
appc = spec[spec.index('## 付録C'):] if '## 付録C' in spec else ''
rows_c = [l for l in appc.splitlines() if l.startswith('| 20')]
todo = [l for l in rows_c if '要：' in l.rstrip(' |').rsplit('|', 1)[-1]]
report(not todo, '付録C の図への反映に「要：」がない', f'{len(todo)} 行残っている。先に /update-diagrams を行うか聞く' if todo else '')

# ---------- 仕様書・図を直したのに付録C に行がない ----------
# 仕様書・図の中身を直したら、その作業の中で付録C に1行足す（2026-11-23 決定）。コミットしていない変更で、
# 仕様書.md（付録C の外）か図の .puml が変わっているのに付録C の行が増えていなければ知らせる（見た目だけの修正なら足さなくてよい）
_, changed = git('-c', 'core.quotepath=false', 'diff', '--name-only', 'HEAD', '--', 'docs/基本設計書/仕様書.md', 'docs/基本設計書/図')
# 図の決まり（図/CLAUDE.md）は中身ではないので数えない
changed = [f for f in changed.splitlines() if f.endswith(('仕様書.md', '.puml'))]
_, head_spec = git('show', 'HEAD:docs/基本設計書/仕様書.md')
head_c = head_spec[head_spec.index('## 付録C'):] if '## 付録C' in head_spec else ''
head_rows = len([l for l in head_c.splitlines() if l.startswith('| 20')])
added_c = len(rows_c) > head_rows
report(not changed or added_c, '直した仕様書・図の付録C の行',
       '' if not changed or added_c else f'{"・".join(os.path.basename(f) for f in changed)} を直したが付録C に行がない。中身の変更なら付録C に1行足す（見た目だけなら足さずに続ける）')

# ---------- 5.2 と 6.2 ----------
sec, s52, s62, todo_impl = None, [], [], []
for l in spec_lines:
    if l.startswith('### '):
        sec = l[4:7]
    elif l.startswith('## '):
        sec = None
    # 5.2 も 6.2 も、機能は ##### の見出し（その上の #### はシステム）
    m5 = re.match(r'##### ([A-Z]\d\d-\d+)', l)
    if sec == '5.2' and m5:
        (todo_impl if '未実装' in l else s52).append(m5.group(1))
    if sec == '6.2' and m5:
        s62.append(m5.group(1))
only52, only62 = sorted(set(s52) - set(s62)), sorted(set(s62) - set(s52))
diff = ('5.2 だけ: ' + ','.join(only52) + ' ' if only52 else '') + ('6.2 だけ: ' + ','.join(only62) if only62 else '')
report(not diff, f'5.2（{len(s52)}機能）と 6.2（{len(s62)}機能）が1対1', diff.strip() + '。先に /update-spec を行うか聞く' if diff else '')

# ---------- 未実装の機能と build_docx.py の文 ----------
build = open(BUILD_PY, encoding='utf-8').read()
in_script = set()
for l in build.splitlines():
    if '未実装の' in l and not l.lstrip().startswith('#'):
        in_script |= set(re.findall(r'[A-Z]\d\d-\d+', l))
ok = set(todo_impl) == in_script
report(ok, '未実装の機能と build_docx.py の文が一致',
       ('仕様書 ' + (','.join(sorted(todo_impl)) or 'なし') + '／スクリプト ' + (','.join(sorted(in_script)) or 'なし') + '。スクリプトの文を直す') if not ok
       else ('未実装なし' if not todo_impl else ','.join(sorted(todo_impl))))

# ---------- 開発のテスト・確認用のもの ----------
body = spec[:spec.index('## 付録B')] if '## 付録B' in spec else spec
hits = []
for i, l in enumerate(body.splitlines(), 1):
    found = [w for w in DEV_ONLY if w in l]
    if found:
        hits.append(f'{i}行目（{found[0]}）')
report(not hits, '開発のテスト・確認用のもの（テスト中の機能切替・自動チェック・メロディの評価・一括計測など）が載っていない',
       '、'.join(hits[:8]) + (f' ほか {len(hits) - 8} 行' if len(hits) > 8 else '') + '。仕様書.md から外す（/update-spec の決まり）' if hits else '')

# ---------- 完成したシステムとしての書き方（2026-11-20 決定） ----------
# 開発の経緯（以前・旧名・廃止・（追加））、内部シンセの別名（lidless）、絵文字・ボタンの記号を書かない
style_hits = []
for i, l in enumerate(body.splitlines(), 1):
    found = [w for w in STYLE_WORDS if w in l] + STYLE_MARKS.findall(l)
    if found:
        style_hits.append(f'{i}行目（{found[0]}）')
# 5.1 の「画面」列に「両方」と書かない（画面名を並べる）
s51 = body[body.index('### 5.1'):body.index('### 5.2')] if '### 5.1' in body and '### 5.2' in body else ''
for l in s51.splitlines():
    c = [x.strip() for x in l.strip('|').split('|')]
    if re.match(r'[A-Z]\d\d-\d+$', c[0]) and len(c) > 2 and '両方' in c[2]:
        style_hits.append(f'5.1 {c[0]} の画面が「両方」')
# 3.1 適用業務範囲の表に「状況」の列を置かない
if re.search(r'\| 業務 \| 対象画面 \| 状況 \|', body):
    style_hits.append('3.1 の表に「状況」の列')
# 2章は指定の4項目だけ（2026-11-20 決定）
SEC2_ITEMS = ['- 対象OSは Windows とする（インストーラは NSIS 形式）。',
              '- インターネット接続は不要とする（オフラインで動作する）。',
              '- 音声出力デバイス（スピーカー・ヘッドホン）があること。',
              '- ターゲットは「音楽制作未経験者」「アイデアを得たい作曲経験者」とする。']
m2 = re.search(r'## 2\. 制約条件・前提条件\n(.*?)\n## 3\. ', body, re.S)
sec2 = [l.strip() for l in m2.group(1).splitlines() if l.strip()] if m2 else []
report(sec2 == SEC2_ITEMS, '2章 制約条件・前提条件が指定の4項目だけ',
       '' if sec2 == SEC2_ITEMS else '手順書の「0. 決まっていること」の4項目に直す（今は ' + str(len(sec2)) + ' 行）')
# 3.2 は指定の3項目だけ・件数を書かない（2026-11-23 決定）
SEC32_ITEMS = ['パターンDB＋ルールで生成', '曲の構成', '2つの入口']
m32 = re.search(r'### 3\.2 システム化の考え方\n(.*?)\n### 3\.3 ', body, re.S)
sec32 = m32.group(1) if m32 else ''
heads32 = re.findall(r'^- \*\*(.+?)\*\*', sec32, re.M)
counts32 = re.findall(r'\d+\s*(?:種|件|個|つ)', re.sub(r'2つの入口', '', sec32))
report(heads32 == SEC32_ITEMS and not counts32, '3.2 システム化の考え方が指定の3項目だけで、件数を書いていない',
       '' if heads32 == SEC32_ITEMS and not counts32 else
       f'今の項目：{"・".join(heads32) or "なし"}' + (f'、件数：{"・".join(counts32)}' if counts32 else '') + '。手順書の「0. 決まっていること」の「3.2 システム化の考え方」に直す')
report(not style_hits, '完成したシステムとしての書き方（開発の経緯・作成途中の語（テスト中など）・lidless・絵文字・「両方」・「状況」の列がない）',
       '、'.join(style_hits[:8]) + (f' ほか {len(style_hits) - 8} 件' if len(style_hits) > 8 else '') + '。仕様書.md を直す（手順書の「0. 決まっていること」の「書き方」）' if style_hits else '')

# ---------- 改訂の概要の材料 ----------
guide = open(GUIDE, encoding='utf-8').read()
pm = re.search(r'\| 5\. docx を作る \|[^\n]*?(\d+)ページ', guide)
report(None, '次の版数', f'{nxt}（前回 {last[0]}：{last[1]}、{pm.group(1) + "ページ" if pm else "ページ数不明"}）' + '。中身の改訂がなくレイアウトだけの修正なら、版は上げずに前回の版のまま作り直す（-RevNote を省く）')
since = [l for l in rows_c if l[2:12].replace('-', '/') > last[1]]
lines.append(f'[--] 前回（{last[1]}）より後の日付の付録C の行（改訂の概要の材料。前回と同じ日に足した行は入らない）：{len(since)} 行')
for l in since:
    cells = [c.strip() for c in l.strip('|').split('|')]
    lines.append(f'     - {cells[0]} {cells[1]}：{cells[2][:150]}')

text = '\n'.join(lines + [f'NG: {ng} 件'])
if args.out:
    open(args.out, 'w', encoding='utf-8').write(text + '\n')
sys.stdout.reconfigure(encoding='utf-8')
print(text)
sys.exit(1 if ng else 0)
