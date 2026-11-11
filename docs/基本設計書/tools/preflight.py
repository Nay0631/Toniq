# docx を作る前の確認（/build-design-doc の 0〜2 をまとめたもの）
#
# 必要なもの・出力先が開かれていないか・仕様書が origin/main に追いついているか・付録C の「要：」・
# 5.2 と 6.2 の対応・未実装の機能と build_docx.py の文・次の版数と改訂の概要の材料を、OK / NG で数行に出す。
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
OUT_DOCX = os.path.join(DOC, '作成ファイル', '04_2026_卒研_基本設計書(R4SA_アプリオリ)_仕様書から作成.docx')
REV_FILE = os.path.join(HERE, '改訂履歴.tsv')
BUILD_PY = os.path.join(HERE, 'build_docx.py')
CODE_PATHS = ['src', 'index.html', 'electron', 'public', 'package.json']

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
if not os.path.isdir(r'C:\Program Files\Microsoft Office'):
    missing.append('Word（Microsoft 365）')
if not os.path.exists(TEMPLATE):
    missing.append('手本の docx（git restore で戻す。消さない）')
report(not missing, '必要なもの（Java・Python・Word・手本の docx）', '、'.join(missing) + ' がない' if missing else '')

# ---------- 出力先が開かれていないか ----------
locked = False
if os.path.exists(OUT_DOCX):
    try:
        open(OUT_DOCX, 'r+b').close()
    except OSError:
        locked = True
report(not locked, '出力先の docx が閉じている', 'Word などで開かれている。閉じてから作る' if locked else '')

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

# ---------- 5.2 と 6.2 ----------
sec, s52, s62, todo_impl = None, [], [], []
for l in spec_lines:
    if l.startswith('### '):
        sec = l[4:7]
    elif l.startswith('## '):
        sec = None
    m4 = re.match(r'#### ([A-Z]\d\d-\d+)', l)
    m5 = re.match(r'##### ([A-Z]\d\d-\d+)', l)
    if sec == '5.2' and m4:
        (todo_impl if '未実装' in l else s52).append(m4.group(1))
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

# ---------- 次の版数と改訂の概要の材料 ----------
revs = []
if os.path.exists(REV_FILE):
    for l in open(REV_FILE, encoding='utf-8').read().splitlines():
        if l.strip() and not l.startswith('#'):
            revs.append(l.split('\t', 2))
last = revs[-1] if revs else ['01', '2026/10/19', '初版発行']
nxt = f'{int(last[0]) + 1:02d}'
guide = open(GUIDE, encoding='utf-8').read()
pm = re.search(r'\| 5\. docx を作る \|[^\n]*?(\d+)ページ', guide)
report(None, '次の版数', f'{nxt}（前回 {last[0]}：{last[1]}、{pm.group(1) + "ページ" if pm else "ページ数不明"}）')
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
