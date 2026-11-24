# できた docx を確かめる（build_docx.ps1 の最後に呼ぶ。PDF にして目で見る代わり）
#
# 表紙の文書番号・日付、改訂履歴の行（01 ＋ 改訂履歴.tsv）、目次、機能定義の表・ユースケース記述の表の数（仕様書.md と比べる）、
# 図の数（SVG と PNG）を OK / NG で数行に出す。NG が1つでもあれば終了コード 1。結果は UTF-8 のファイル（--out）にも書く。
# 見た目（崩れ・改ページ）までは確かめられないので、それは Word で開いて目で見る。
#
# 使い方:
#   py check_docx.py 出力.docx 仕様書.md 版数 日付(YYYY/MM/DD) [--out 結果.txt]
import argparse, os, re, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('docx')
ap.add_argument('spec')
ap.add_argument('rev')
ap.add_argument('date')
ap.add_argument('--out')
args = ap.parse_args()
Y, M, D = (int(x) for x in args.date.split('/'))

z = zipfile.ZipFile(args.docx)
x = z.read('word/document.xml').decode('utf-8')
T = lambda s: ''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>', s))
tables = re.findall(r'<w:tbl>.*?</w:tbl>', x, re.S)

lines, ng = [], 0
def report(ok, label, detail=''):
    global ng
    if not ok:
        ng += 1
    lines.append(f'[{"OK" if ok else "NG"}] {label}' + (f'：{detail}' if detail else ''))

# 表紙
m = re.search(r'文書番号：</w:t>.*?</w:p>', x, re.S)
num = T(m.group(0)) if m else ''
report(num.endswith(f'({args.rev})'), '表紙の文書番号', num or '見つからない')
paras = [T(p) for p in re.findall(r'<w:p[ >].*?</w:p>', x[:200000], re.S)]
cover_date = f'{Y}年{M}月{D}日'
report(cover_date in paras, '表紙の日付', cover_date if cover_date in paras else f'{cover_date} が見つからない')

# 改訂履歴
want = [('01', '2026/10/19')]
rf = os.path.join(HERE, '改訂履歴.tsv')
if os.path.exists(rf):
    for l in open(rf, encoding='utf-8').read().splitlines():
        if l.strip() and not l.startswith('#'):
            v, d, _ = l.split('\t', 2)
            want.append((v, d))
rt = next((t for t in tables if '初版発行' in t), '')
got = []
for r in re.findall(r'<w:tr\b.*?</w:tr>', rt, re.S)[1:]:
    cs = [T(c) for c in re.findall(r'<w:tc>.*?</w:tc>', r, re.S)]
    if cs and cs[0]:
        got.append((cs[0], cs[1]))
report(got == want and want[-1][0] == args.rev, '改訂履歴', ' → '.join(f'{v}（{d}）' for v, d in got))

# 改訂履歴の見出しの「改訂年月日」が1行（1つの段落）か
hdr = re.findall(r'<w:tr\b.*?</w:tr>', rt, re.S)[0] if rt else ''
hcs = re.findall(r'<w:tc>.*?</w:tc>', hdr, re.S)
hps = [T(p) for p in re.findall(r'<w:p[ >].*?</w:p>', hcs[1], re.S)] if len(hcs) > 1 else []
report(hps == ['改訂年月日'], '改訂履歴の見出し「改訂年月日」が1行', ' / '.join(hps) or '見つからない')
# 改訂年月日の値（2026/11/09 など）が折り返さないよう、日付の列が 1500（75pt）以上か（2026-11-23 決定。
# 手本のフォントは数字の幅が広く、日付は約 63pt。手本の 1260 = 63pt では左右の余白を除くと収まらない）
dws = [int(re.findall(r'<w:tcW w:w="(\d+)"', re.findall(r'<w:tc>.*?</w:tc>', r, re.S)[1])[0])
       for r in re.findall(r'<w:tr\b.*?</w:tr>', rt, re.S) if re.search(r'<w:t>\d{4}/\d{2}/\d{2}</w:t>', r)]
report(bool(dws) and min(dws) >= 1500, '改訂履歴の日付が1行（日付の列の幅）', f'{len(dws)} 行・幅 {min(dws) if dws else "-"}')
# 各版の行の承認責任者・作成責任者（2026-11-23 決定）
names = [tuple(T(c) for c in re.findall(r'<w:tc>.*?</w:tc>', r, re.S)[-2:])
         for r in re.findall(r'<w:tr\b.*?</w:tr>', rt, re.S) if re.search(r'<w:t>\d{4}/\d{2}/\d{2}</w:t>', r)]
report(bool(names) and all(n == ('根井', '西薗') for n in names), '改訂履歴の承認責任者・作成責任者（根井・西薗）',
       f'{len(names)} 行' if names and all(n == ('根井', '西薗') for n in names) else '違う行：' + '・'.join('/'.join(n) for n in names if n != ('根井', '西薗')))

# 添付資料(別紙)
allp = [T(p) for p in re.findall(r'<w:p[ >].*?</w:p>', x, re.S)]
bi = allp.index('添付資料(別紙)') if '添付資料(別紙)' in allp else -1
bs = [p for p in allp[bi + 1:bi + 4] if p.startswith('別紙')] if bi >= 0 else []
report(bs == ['別紙1　画面レイアウト.pdf'], '添付資料(別紙)', '・'.join(bs) or '見つからない')
report('別紙1のPDFを参照' in allp, '10.3.1 画面レイアウトの「別紙1のPDFを参照」')

# 目次
toc = len(re.findall(r'TOC \\', x))
report(toc > 0, '目次', 'あり' if toc else '目次のフィールドがない')

# 機能定義・ユースケース記述の表（仕様書.md の 5.2 / 6.2 と比べる）
spec = open(args.spec, encoding='utf-8').read().splitlines()
sec, n52, n62 = None, 0, 0
for l in spec:
    if l.startswith('### '):
        sec = l[4:7]
    elif l.startswith('## '):
        sec = None
    # 5.2 も 6.2 も、機能は ##### の見出し（その上の #### はシステム）
    if sec == '5.2' and re.match(r'##### [A-Z]\d\d-\d+', l) and '未実装' not in l:
        n52 += 1
    if sec == '6.2' and re.match(r'##### [A-Z]\d\d-\d+', l):
        n62 += 1
fd = sum(1 for t in tables if '機能ID' in T(t) and '事前条件' in T(t))
uc = sum(1 for t in tables if 'ユースケース名' in T(t) and '基本フロー' in T(t))
report(fd == n52, '機能定義の表', f'{fd} 個（仕様書 5.2：{n52}）')
report(uc == n62, 'ユースケース記述の表', f'{uc} 個（仕様書 6.2：{n62}）')

# 図
media = [n for n in z.namelist() if n.startswith('word/media/')]  # Word が保存するとファイル名は付け直される
svg = sum(n.endswith('.svg') for n in media)
png = sum(n.endswith('.png') for n in media)
refs = sum(1 for l in spec if re.search(r'!\[[^\]]*\]\([^)]*\.svg\)', l))
report(svg == png == refs, '図', f'SVG {svg}・PNG {png}（仕様書の図の参照：{refs}）')

lines.append(f'ファイルの大きさ: {os.path.getsize(args.docx) / 1024 / 1024:.1f}MB')
text = '\n'.join(lines + [f'NG: {ng} 件'])
if args.out:
    open(args.out, 'w', encoding='utf-8').write(text + '\n')
sys.stdout.reconfigure(encoding='utf-8')
print(text)
sys.exit(1 if ng else 0)
