# 仕様書.md から基本設計書 docx の下書きを作る（作成ファイルの docx を書式の手本として使う）
#
# ふつうは build_docx.ps1 から呼ぶ（PNG の用意 → このスクリプト → Word で目次の更新と保存）。
# 手本の docx の本文を「段落・表の並び」に分け、番号で場所を決めて使っている
# （表紙・改訂履歴・目次 = 0〜148、裏表紙 = 460〜、機能定義の表の手本 = 203、改訂履歴の表 = 33、表紙の日付 = 23、表紙の文書番号 = 10）。
# 改訂履歴の 02 以降は tools/改訂履歴.tsv に残し、今回の版（rev）を足して書き戻す。表紙の文書番号の「(01)」は rev にする。
# 手本の docx を編集すると番号がずれるので、そのときは番号を見直す（ずれると assert で止まる）。
# 6.2 ユースケース記述の表は手本にないので usecase_table で組み立てる（表の行が足りないと assert で止まる）。
#
# 使い方:
#   py build_docx.py 仕様書.md 手本.docx PNGフォルダ 図フォルダ 出力.docx 日付(YYYY/MM/DD) 改訂番号 改訂の概要
import argparse, re, sys, os, zipfile
from xml.sax.saxutils import escape

ap = argparse.ArgumentParser(description='仕様書.md から基本設計書 docx の下書きを作る')
ap.add_argument('spec')
ap.add_argument('template')
ap.add_argument('pngdir')
ap.add_argument('figroot')
ap.add_argument('out')
ap.add_argument('date', help='表紙と改訂履歴の日付（例 2026/11/09）')
ap.add_argument('rev', help='改訂履歴に足す版数（例 02）')
ap.add_argument('rev_note', help='改訂履歴に足す改訂の概要')
args = ap.parse_args()
SPEC, TEMPLATE, PNGDIR, FIGROOT, OUT = args.spec, args.template, args.pngdir, args.figroot, args.out
Y, M, D = (int(x) for x in args.date.split('/'))

# ---------- 手本の docx の本文を、いちばん外側の段落・表などに分ける ----------
def split_body(path):
    x = zipfile.ZipFile(path).read('word/document.xml').decode('utf-8')
    b = x[x.index('<w:body>') + 8:]
    pat = re.compile(r'<(/?)(w:p|w:tbl|w:sdt|w:bookmarkStart|w:bookmarkEnd|w:sectPr)\b[^>]*?(/?)>')
    res = []
    depth = 0
    start = name = None
    for m in pat.finditer(b):
        close, tag, selfc = m.group(1), m.group(2), m.group(3)
        if depth == 0:
            if close:
                break
            start, name = m.start(), tag
            if selfc:
                res.append(b[start:m.end()])
                continue
            depth = 1
            continue
        if tag == name:
            if close:
                depth -= 1
            elif not selfc:
                depth += 1
            if depth == 0:
                res.append(b[start:m.end()])
    return res

els = split_body(TEMPLATE)
md = open(SPEC, encoding='utf-8').read().splitlines()

def clean(x):
    x = re.sub(r' w14:(paraId|textId)="[^"]*"', '', x)
    x = x.replace('<w:lastRenderedPageBreak/>', '')
    return x

# ---------- インライン ----------
def inline(text):
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    text = text.replace('`', '')
    out = []
    parts = re.split(r'(\*\*)', text)
    bold = False
    for p in parts:
        if p == '**':
            bold = not bold
            continue
        if p:
            out.append((p, bold))
    return out

def inline_plain(text):
    return ''.join(t for t, b in inline(text))

def runs(text, rpr=''):
    xml = ''
    for t, b in inline(text):
        r = rpr
        if b:
            r = r.replace('<w:rPr>', '<w:rPr><w:b/>') if r else '<w:rPr><w:b/></w:rPr>'
        xml += f'<w:r>{r}<w:t xml:space="preserve">{escape(t)}</w:t></w:r>'
    return xml

# ---------- 段落 ----------
def heading(level, text, page_break=False, nonum=False):
    ppr = f'<w:pStyle w:val="{level}"/>'
    if page_break:
        ppr += '<w:pageBreakBefore/>'
    if nonum:
        ppr += '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>'
    return f'<w:p><w:pPr>{ppr}</w:pPr>{runs(text)}</w:p>'

def para(text):
    return f'<w:p><w:pPr><w:pStyle w:val="a2"/><w:ind w:firstLineChars="100" w:firstLine="210"/></w:pPr>{runs(text)}</w:p>'

def bullet(text, mark='・'):
    return f'<w:p><w:pPr><w:pStyle w:val="a2"/><w:ind w:left="1061" w:hanging="210"/></w:pPr>{runs(mark + text)}</w:p>'

def numbered(text):
    m = re.match(r'(\d+)\.\s*(.*)', text)
    return f'<w:p><w:pPr><w:pStyle w:val="a2"/><w:ind w:left="1271" w:hanging="420"/></w:pPr>{runs(m.group(1) + ". " + m.group(2))}</w:p>'

def empty():
    return '<w:p><w:pPr><w:pStyle w:val="a2"/></w:pPr></w:p>'

# ---------- 一般の表（手本: 1.1 の表） ----------
TBL_W = 9283
def width_of(s):
    return sum(2 if ord(c) > 0x2000 else 1 for c in s)

def generic_table(rows, title=None):
    # title：表の1行目に、列を全部結合して出す表題（仕様書.md で表の直前に置いた「**…**」だけの行。5.1 のシステム名、10.3.2 の画面名）
    ncol = len(rows[0])
    need = []
    for c in range(ncol):
        w = max(width_of(inline_plain(r[c])) if c < len(r) else 0 for r in rows)
        need.append(w)
    # 短い列（ID・名前など）は折り返さない幅にし、残りを長い列で分ける
    widths = [0] * ncol
    short = [c for c in range(ncol) if need[c] <= 26]
    for c in short:
        widths[c] = need[c] * 112 + 200
    longc = [c for c in range(ncol) if c not in short]
    # 長い列には最低 2800 ずつ残し、足りなければ短い列を同じ比率で縮める
    room = TBL_W - 2800 * len(longc)
    if sum(widths) > room:
        fixed = [c for c in short if need[c] <= 10]   # ID などの狭い列は縮めない
        flex = [c for c in short if need[c] > 10]
        avail = room - sum(widths[c] for c in fixed)
        k = avail / max(1, sum(widths[c] for c in flex))
        for c in flex:
            widths[c] = int(widths[c] * k)
    rest = TBL_W - sum(widths)
    if longc:
        tot = sum(min(need[c], 80) for c in longc)
        for c in longc:
            widths[c] = int(rest * min(need[c], 80) / tot)
    if not longc:  # 全部短い列なら比率で広げる
        tot = sum(widths)
        widths = [int(w * TBL_W / tot) for w in widths]
    widths[-1] += TBL_W - sum(widths)
    tblpr = ('<w:tblPr><w:tblW w:w="9283" w:type="dxa"/><w:tblInd w:w="210" w:type="dxa"/><w:tblBorders>'
             + ''.join(f'<w:{b} w:val="single" w:sz="4" w:space="0" w:color="auto"/>' for b in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])
             + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="57" w:type="dxa"/><w:right w:w="57" w:type="dxa"/></w:tblCellMar>'
               '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>')
    grid = '<w:tblGrid>' + ''.join(f'<w:gridCol w:w="{w}"/>' for w in widths) + '</w:tblGrid>'
    xml = '<w:tbl>' + tblpr + grid
    if title:
        rpr = '<w:rPr><w:rFonts w:hAnsi="ＭＳ Ｐゴシック" w:hint="eastAsia"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>'
        xml += ('<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>'
                f'<w:tc><w:tcPr><w:tcW w:w="{TBL_W}" w:type="dxa"/><w:gridSpan w:val="{ncol}"/>'
                '<w:shd w:val="clear" w:color="auto" w:fill="B4C6E7" w:themeFill="accent5" w:themeFillTint="66"/><w:vAlign w:val="center"/></w:tcPr>'
                f'<w:p><w:pPr><w:spacing w:line="280" w:lineRule="exact"/><w:jc w:val="left"/></w:pPr>{runs(title, rpr)}</w:p></w:tc></w:tr>')
    for i, r in enumerate(rows):
        hdr = i == 0
        trpr = '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' if hdr else '<w:trPr><w:cantSplit/></w:trPr>'
        xml += '<w:tr>' + trpr
        for c in range(ncol):
            txt = r[c] if c < len(r) else ''
            shd = '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3" w:themeFill="accent5" w:themeFillTint="33"/>' if hdr else ''
            font = 'w:hAnsi="ＭＳ Ｐゴシック"' if hdr else 'w:hAnsiTheme="minorEastAsia"'
            jc = 'center' if hdr else 'left'
            rpr = f'<w:rPr><w:rFonts {font} w:hint="eastAsia"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>'
            xml += (f'<w:tc><w:tcPr><w:tcW w:w="{widths[c]}" w:type="dxa"/>{shd}<w:vAlign w:val="center"/></w:tcPr>'
                    f'<w:p><w:pPr><w:spacing w:line="280" w:lineRule="exact"/><w:jc w:val="{jc}"/></w:pPr>{runs(txt, rpr)}</w:p></w:tc>')
        xml += '</w:tr>'
    return xml + '</w:tbl>' + empty()

# ---------- 機能定義の表（手本: 5.2.1 の表、19行） ----------
FT = clean(els[203])
FT_HEAD = FT[:FT.index('<w:tr')]
FT_ROWS = re.findall(r'<w:tr\b.*?</w:tr>', FT, re.S)
assert len(FT_ROWS) == 19
VAL_RPR = '<w:rPr><w:rFonts w:hAnsiTheme="minorEastAsia" w:cs="ＭＳ Ｐゴシック" w:hint="eastAsia"/><w:kern w:val="0"/><w:sz w:val="20"/></w:rPr>'

def set_value(row, text):
    tcs = re.findall(r'<w:tc>.*?</w:tc>', row, re.S)
    v = tcs[1]
    tcpr = re.search(r'<w:tcPr>.*?</w:tcPr>', v, re.S).group(0)
    ppr = re.search(r'<w:pPr>.*?</w:pPr>', v, re.S).group(0)
    paras = ''.join(f'<w:p>{ppr}{runs(line, VAL_RPR)}</w:p>' for line in (text.split('\n') if text else ['']))
    newv = f'<w:tc>{tcpr}{paras}</w:tc>'
    return row.replace(v, newv, 1)

CATS = ['画面', '帳票', 'データベース', 'ファイル', 'その他']
def split_io(s):
    res = {c: 'なし' for c in CATS}
    if s.strip() in ('', '―', 'なし'):
        return res
    pos = [(m.start(), m.group(2), m.end()) for m in re.finditer(r'(^|／)(画面|帳票|データベース|ファイル|その他)：', s)]
    if not pos:
        res['その他'] = s
        return res
    for i, (st, cat, en) in enumerate(pos):
        end = pos[i + 1][0] if i + 1 < len(pos) else len(s)
        res[cat] = s[en:end].strip()
    return res

def function_table(fid, fname, kv):
    vals = [fid, fname, '利用者', kv.get('事前条件', ''), kv.get('事後条件', ''), '']
    i = split_io(kv.get('入力', ''))
    o = split_io(kv.get('出力', ''))
    vals += [i[c] for c in CATS] + [''] + [o[c] for c in CATS]
    vals += [kv.get('機能説明', ''), kv.get('備考', '')]
    rows = [set_value(r, v) for r, v in zip(FT_ROWS, vals)]
    return FT_HEAD + ''.join(rows) + '</w:tbl>' + empty()

# ---------- ユースケース記述の表（6.2。手本の docx にはないので組み立てる） ----------
# 1行目は「作成日｜値｜版数｜値｜作者｜値」の6列、2行目からは「項目｜内容（5列分を結合）」。
UC_W = [1900, 1750, 1000, 650, 1000, 2983]
assert sum(UC_W) == TBL_W
UC_HEAD = ['作成日', '版数', '作者']
UC_ROWS = ['ユースケース名', '概要', '主アクタ', '支援アクタ', '事前条件', '事後条件', 'トリガー',
           '基本フロー', '代替フロー', '例外フロー', '備考・注記']
UC_LABEL_RPR = '<w:rPr><w:rFonts w:hAnsiTheme="minorEastAsia" w:hint="eastAsia"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>'
UC_VAL_RPR = '<w:rPr><w:rFonts w:hAnsiTheme="minorEastAsia" w:hint="eastAsia"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>'

def uc_cell(w, text, rpr, span=1, center=False):
    gs = f'<w:gridSpan w:val="{span}"/>' if span > 1 else ''
    jc = 'center' if center else 'left'
    lines = [x.strip() for x in text.split('<br>')] if text else ['']
    paras = ''.join(f'<w:p><w:pPr><w:spacing w:line="300" w:lineRule="auto"/><w:jc w:val="{jc}"/></w:pPr>{runs(x, rpr)}</w:p>' for x in lines)
    return f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/>{gs}<w:vAlign w:val="center"/></w:tcPr>{paras}</w:tc>'

def usecase_table(kv):
    missing = [k for k in UC_HEAD + UC_ROWS if k not in kv]
    assert not missing, ('ユースケース記述の表に行がない', kv.get('ユースケース名'), missing)
    tblpr = ('<w:tblPr><w:tblW w:w="9283" w:type="dxa"/><w:tblInd w:w="210" w:type="dxa"/><w:tblBorders>'
             + ''.join(f'<w:{b} w:val="single" w:sz="8" w:space="0" w:color="auto"/>' for b in ['top', 'left', 'bottom', 'right'])
             + ''.join(f'<w:{b} w:val="single" w:sz="4" w:space="0" w:color="auto"/>' for b in ['insideH', 'insideV'])
             + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="85" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar>'
               '<w:tblLook w:val="04A0" w:firstRow="0" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>')
    grid = '<w:tblGrid>' + ''.join(f'<w:gridCol w:w="{w}"/>' for w in UC_W) + '</w:tblGrid>'
    xml = '<w:tbl>' + tblpr + grid
    # 1行目：作成日・版数・作者
    xml += '<w:tr><w:trPr><w:cantSplit/></w:trPr>'
    for i, k in enumerate(UC_HEAD):
        xml += uc_cell(UC_W[i * 2], k, UC_LABEL_RPR)
        xml += uc_cell(UC_W[i * 2 + 1], kv[k], UC_LABEL_RPR, center=True)
    xml += '</w:tr>'
    # 2行目から：項目と内容
    for k in UC_ROWS:
        xml += ('<w:tr><w:trPr><w:cantSplit/></w:trPr>' + uc_cell(UC_W[0], k, UC_LABEL_RPR)
                + uc_cell(TBL_W - UC_W[0], kv[k], UC_VAL_RPR, span=5) + '</w:tr>')
    return xml + '</w:tbl>' + empty()

# ---------- 図 ----------
IMG = []   # (rid_png, rid_svg, png_path, svg_path)
def svg_size(path):
    head = open(path, encoding='utf-8').read(3000)
    m = re.search(r'<svg[^>]*>', head).group(0)
    w = re.search(r'width:(\d+(?:\.\d+)?)px', m) or re.search(r'width="(\d+(?:\.\d+)?)(?:px)?"', m)
    h = re.search(r'height:(\d+(?:\.\d+)?)px', m) or re.search(r'height="(\d+(?:\.\d+)?)(?:px)?"', m)
    return float(w.group(1)), float(h.group(1))

MAXW = 9283 * 635
MAXH = 12600 * 635
def image(rel_svg, name):
    svg = os.path.join(FIGROOT, rel_svg.replace('図/', '', 1))
    png = os.path.join(PNGDIR, os.path.basename(svg)[:-4] + '.png')
    assert os.path.exists(svg), svg
    assert os.path.exists(png), png
    w, h = svg_size(svg)
    cx, cy = w * 9525, h * 9525
    s = min(1.0, MAXW / cx, MAXH / cy)
    cx, cy = int(cx * s), int(cy * s)
    n = len(IMG) + 1
    rp, rs = f'rIdTqP{n}', f'rIdTqS{n}'
    IMG.append((rp, rs, png, svg, n))
    did = 5000 + n
    d = (f'<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/>'
         f'<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="{did}" name="図 {did}" descr="{escape(name)}"/>'
         '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
         '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
         '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
         f'<pic:nvPicPr><pic:cNvPr id="{did}" name="fig{n}.png"/><pic:cNvPicPr/></pic:nvPicPr>'
         f'<pic:blipFill><a:blip r:embed="{rp}"><a:extLst><a:ext uri="{{96DAC541-7B7A-43D3-8B79-37D633B846F1}}">'
         f'<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="{rs}"/></a:ext></a:extLst></a:blip>'
         '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
         f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
         '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>')
    return f'<w:p><w:pPr><w:spacing w:before="120" w:after="240"/><w:jc w:val="center"/></w:pPr><w:r>{d}</w:r></w:p>'

# ---------- Markdown をブロックに分ける ----------
blocks = []
i = 0
while i < len(md):
    L = md[i]
    if L.startswith('#'):
        m = re.match(r'(#+)\s+(.*)', L)
        blocks.append(('h', len(m.group(1)), m.group(2).strip())); i += 1
    elif L.startswith('|'):
        rows = []
        while i < len(md) and md[i].startswith('|'):
            cells = [c.strip() for c in md[i].strip().strip('|').split('|')]
            if not all(re.fullmatch(r':?-+:?', c) for c in cells):
                rows.append(cells)
            i += 1
        blocks.append(('t', rows))
    elif L.startswith('!['):
        m = re.match(r'!\[([^\]]*)\]\(([^)]+)\)', L)
        blocks.append(('img', m.group(1), m.group(2))); i += 1
    elif L.startswith('>'):
        i += 1
    elif L.strip() == '---' or L.strip() == '':
        i += 1
    elif re.match(r'\s*- ', L):
        blocks.append(('b', re.sub(r'^\s*- ', '', L))); i += 1
    elif re.match(r'\s*\d+\. ', L):
        blocks.append(('n', L.strip())); i += 1
    else:
        blocks.append(('p', L.strip())); i += 1

# 「**…**」だけの段落の直後に表があれば、表の1行目の表題にする（段落としては出さない）
merged = []
for b in blocks:
    if b[0] == 't' and merged and merged[-1][0] == 'p' and re.fullmatch(r'\*\*[^*]+\*\*', merged[-1][1]):
        merged[-1] = ('t', b[1], merged[-1][1].strip('*'))
    else:
        merged.append(b)
blocks = merged

# 機能名（5.1 機能一覧）
FNAME = {}
for b in blocks:
    if b[0] == 't' and b[1][0][:2] == ['機能ID', '機能名']:
        for r in b[1][1:]:
            FNAME[r[0]] = r[1]

# ---------- 変換 ----------
out = []
chapter = None
fig_chapter = None   # 7/8/9 章をまとめた節を図の種類ごとに分ける
fig_items = []       # (heading, [(alt, path)])
func = None
skip = False

def strip_num(t):
    return re.sub(r'^\d+(\.\d+)*\.?\s+', '', t)

FIG_INTRO = {
    'ロバストネス図': '機能ごとのロバストネス図を、システム（グループ）ごとに示す。',
    'シーケンス図': '機能ごとのシーケンス図を、システム（グループ）ごとに示す。',
    'クラス図': 'システム全体のクラス図と、機能ごとのクラス図をシステム（グループ）ごとに示す。',
}
SYS_HEAD = re.compile(r'[A-Z]\d\d_')   # 7〜9章のシステムの見出し（### B01_曲の基本設定システム）

def flush_fig():
    global fig_items
    if not fig_items:
        return
    whole = [it for it in fig_items if it[0] == '全体のクラス図']
    per = [it for it in fig_items if it[0] != '全体のクラス図']
    for kind in ['ロバストネス図', 'シーケンス図', 'クラス図']:
        out.append(heading(1, kind, page_break=True))
        out.append(para(FIG_INTRO[kind]))
        if kind == 'クラス図':
            for h, imgs, paras in whole:
                out.append(heading(2, '全体のクラス図'))
                for alt, p in imgs:
                    out.append(image(p, '全体_クラス図'))
                for p in paras:
                    out.append(para(p))
        group = None   # まだ出していないシステムの見出し（その種類の図がある機能が来たら出す）
        for h, imgs, paras in per:
            if SYS_HEAD.match(h):
                group = h
                continue
            for alt, p in imgs:
                if alt == kind:
                    if group:
                        out.append(heading(2, group))
                        group = None
                    # 機能の見出しは「機能ID　機能名」（間は全角スペース1つ。B01-1_BPM選択機能 → B01-1　BPM選択機能）
                    out.append(heading(3, h.replace('_', '　', 1)))
                    out.append(image(p, os.path.basename(p)[:-4]))
    fig_items = []

pending_func = None
for b in blocks:
    kind = b[0]
    if kind == 'h':
        lvl, text = b[1], b[2]
        if lvl == 1:
            continue
        if lvl == 2:
            flush_fig()
            skip = False
            func = None
            if text.startswith('付録B') or text.startswith('付録C'):
                skip = True
                continue
            if text.startswith('7. ロバストネス図'):
                fig_chapter = True
                continue
            fig_chapter = None
            if text.startswith('付録A'):
                out.append(heading(1, text, page_break=True, nonum=True))
                chapter = 'A'
                continue
            chapter = text
            title = strip_num(text)
            out.append(heading(1, title, page_break=True))
            continue
        if skip:
            continue
        if fig_chapter:
            fig_items.append((text, [], []))
            continue
        if chapter == 'A':
            out.append(heading(2, text, nonum=True))
            continue
        m = re.match(r'([A-Z]\d\d-\d+)\s+(.*)', text)
        if lvl == 5 and m and chapter and chapter.startswith('5.'):
            func = m.group(1)
            # 5.2 はシステム（#### B01_曲の基本設定システム → 見出し3）の下に機能（##### → 見出し4）を置く。
            # 見出しは機能名だけにする（機能IDは機能定義の表の「機能ID」の行に書く。「（追加）」などの注記も外す）
            out.append(heading(4, re.sub(r'（[^）]*）$', '', m.group(2)).strip()))
            continue
        if chapter and chapter.startswith('6.'):
            # 6.1 ユースケース図・6.2 ユースケース記述 → 見出し2、図名・機能グループ → 見出し3、
            # ユースケース（##### B01-1 BPM選択機能）→ 見出し4（機能名だけ。「（追加）」などの注記も外す）
            if lvl == 3:
                out.append(heading(2, strip_num(text)))
            elif lvl == 4:
                out.append(heading(3, text))
            else:
                t = re.sub(r'^[A-Z]\d\d-\d+\s+', '', text)
                out.append(heading(4, re.sub(r'（[^）]*）$', '', t).strip()))
            continue
        out.append(heading(min(lvl - 1, 3), strip_num(text)))
        continue
    if skip:
        continue
    if fig_chapter:
        if kind == 'img':
            if fig_items:
                fig_items[-1][1].append((b[1], b[2]))
        elif kind == 'p' and fig_items:
            fig_items[-1][2].append(b[1])
        continue
    if kind == 'p':
        t = b[1]
        if chapter and chapter.startswith('6.') and 'ファイル名の決まり' in t:
            t = '全体と、グループ（システム）ごとのユースケース図を示す。'
        out.append(para(t))
    elif kind == 'b':
        out.append(bullet(b[1]))
    elif kind == 'n':
        out.append(numbered(b[1]))
    elif kind == 'img':
        out.append(image(b[2], os.path.basename(b[2])[:-4]))
    elif kind == 't':
        rows = b[1]
        if rows[0] == ['項目', '内容'] and func:
            kv = {r[0]: r[1] for r in rows[1:]}
            out.append(function_table(func, FNAME.get(func, ''), kv))
            func = None
        elif rows[0] == ['項目', '記述'] and chapter and chapter.startswith('6.'):
            out.append(usecase_table({r[0]: r[1] for r in rows[1:]}))
        elif chapter and chapter.startswith('16.') and rows[0][0] == '節':
            for r in rows[1:]:
                out.append(heading(2, strip_num(r[0])))
                out.append(para(r[1]))
        else:
            out.append(generic_table(rows, b[2] if len(b) > 2 else None))
flush_fig()

body = ''.join(out)

# ---------- 前後の部分（表紙・改訂履歴・目次・裏表紙）はそのまま使う ----------
front = els[:149]
back = els[460:]

# 改訂履歴（02 以降）は tools/改訂履歴.tsv に残す。今回の版を足し（同じ版なら上書き）、版数の順に書き戻す
REV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '改訂履歴.tsv')
rev_head, revs = [], {}
if os.path.exists(REV_FILE):
    for line in open(REV_FILE, encoding='utf-8').read().splitlines():
        if line.startswith('#') or not line.strip():
            rev_head.append(line)
            continue
        v, d, note = line.split('\t', 2)
        revs[v] = (d, note)
assert '\t' not in args.rev_note, '改訂の概要にタブは使えません'
revs[args.rev] = (f'{Y:04d}/{M:02d}/{D:02d}', args.rev_note)
rev_list = sorted(revs.items(), key=lambda kv: int(kv[0]))
with open(REV_FILE, 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(rev_head + [f'{v}\t{d}\t{n}' for v, (d, n) in rev_list]) + '\n')

# 改訂履歴の表に行を並べる（手本の 01 の行を写して、版数・日付・概要を差し替え、01 の下の空の行に順に入れる。足りなければ足す）
rev = front[33]
rws = re.findall(r'<w:tr\b.*?</w:tr>', rev, re.S)
r1, blanks = rws[1], rws[2:]
assert '>01<' in r1 and '2026/10/19' in r1 and '初版発行' in r1
last = r1
for k, (v, (d, note)) in enumerate(rev_list):
    new = r1.replace('>01<', f'>{escape(v)}<').replace('2026/10/19', d).replace('初版発行', escape(note))
    if k < len(blanks):
        rev = rev.replace(blanks[k], new, 1)
    else:
        rev = rev.replace(last, last + new, 1)
    last = new
front[33] = rev

# 改訂の概要は 700 と 4025 の2つのセルに分かれている（見出し行は gridSpan=2）。版の行はセルを結合して広い1つのセルにする
def merge_summary(row):
    tcs = re.findall(r'<w:tc>.*?</w:tc>', row, re.S)
    a, b = tcs[2], tcs[3]
    assert '<w:tcW w:w="700"' in a and '<w:tcW w:w="4025"' in b
    merged = a.replace('<w:tcW w:w="700" w:type="dxa"/>', '<w:tcW w:w="4725" w:type="dxa"/><w:gridSpan w:val="2"/>')
    return row.replace(a + b, merged, 1) if a + b in row else row.replace(b, '', 1).replace(a, merged, 1)
rws = re.findall(r'<w:tr\b.*?</w:tr>', front[33], re.S)
for r in rws[1:2 + len(rev_list)]:
    front[33] = front[33].replace(r, merge_summary(r), 1)

# 表紙の文書番号の末尾「(01)」は版数にする
assert 'アプリオリ(01)' in front[10], '表紙の文書番号が見つかりません'
front[10] = front[10].replace('アプリオリ(01)', f'アプリオリ({escape(args.rev)})', 1)

# 表が長くなって白紙ページができるので、改訂履歴の後と目次の後の空行を消す
EMPTY_IDX = list(range(34, 54)) + list(range(132, 140)) + list(range(144, 148))
for k in EMPTY_IDX:
    assert re.sub(r'<w:pPr>.*?</w:pPr>', '', front[k]).count('<w:t') == 0 and 'sectPr' not in front[k], k
front = [e for k, e in enumerate(front) if k not in EMPTY_IDX]

# 表紙の日付（空行を消す前の番号のまま。23 < 34 なので影響なし）
if '2026年10月19日' in front[23]:
    front[23] = front[23].replace('2026年10月19日', f'{Y}年{M}月{D}日')
else:
    # 手本では日付の文字が細かい run に分かれている。年・月・日の位置に新しい値を入れ、残りは空にする
    ts = list(re.finditer(r'(<w:t(?: [^>]*)?>)([^<]*)(</w:t>)', front[23]))
    texts = [m.group(2) for m in ts]
    assert texts == ['20', '2', '6', '年', '1', '0', '月', '19', '日'], texts
    newt = [str(Y), '', '', '年', str(M), '', '月', str(D), '日']
    s = front[23]
    for m, nt in reversed(list(zip(ts, newt))):
        s = s[:m.start()] + m.group(1) + nt + m.group(3) + s[m.end():]
    front[23] = s

pagebreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

zin = zipfile.ZipFile(TEMPLATE)
docxml = zin.read('word/document.xml').decode('utf-8')
bstart = docxml.index('<w:body>') + len('<w:body>')
bend = docxml.index('</w:body>')
newdoc = docxml[:bstart] + ''.join(front) + body + pagebreak + ''.join(back) + docxml[bend:]
for ns, uri in [('wp', 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'), ('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')]:
    assert f'xmlns:{ns}="{uri}"' in docxml[:bstart], ns

rels = zin.read('word/_rels/document.xml.rels').decode('utf-8')
add = ''
for rp, rs, png, svg, n in IMG:
    add += f'<Relationship Id="{rp}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/toniq_fig{n}.png"/>'
    add += f'<Relationship Id="{rs}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/toniq_fig{n}.svg"/>'
rels = rels.replace('</Relationships>', add + '</Relationships>')

ct = zin.read('[Content_Types].xml').decode('utf-8')
for ext, mime in [('png', 'image/png'), ('svg', 'image/svg+xml')]:
    if f'Extension="{ext}"' not in ct:
        ct = ct.replace('<Default ', f'<Default Extension="{ext}" ContentType="{mime}"/><Default ', 1)

zout = zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    if item.filename.endswith('/'):
        continue
    data = zin.read(item.filename)
    if item.filename == 'word/document.xml':
        data = newdoc.encode('utf-8')
    elif item.filename == 'word/_rels/document.xml.rels':
        data = rels.encode('utf-8')
    elif item.filename == '[Content_Types].xml':
        data = ct.encode('utf-8')
    elif item.filename == 'word/numbering.xml':
        # 見出し1〜4の番号のあとのタブ位置（と字下げ）を広げる。手本のままだと「5.2.10」「7.32.」のように
        # 番号が2桁になったときにタブ位置を越え、番号と名前の間が空かなくなる
        nb = data.decode('utf-8')
        NUM_POS = {'1': 567, '2': 851, '3': 1134, '4': 1418}
        for sid, pos in NUM_POS.items():
            m = re.search(r'<w:lvl w:ilvl="\d"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="' + sid + r'"/>.*?</w:lvl>', nb, re.S)
            assert m, ('見出しの番号の定義がない', sid)
            lv = re.sub(r'<w:tab w:val="num" w:pos="\d+"/>', f'<w:tab w:val="num" w:pos="{pos}"/>', m.group(0))
            lv = re.sub(r'<w:ind w:left="\d+" w:hanging="\d+"/>', f'<w:ind w:left="{pos}" w:hanging="{pos}"/>', lv)
            nb = nb.replace(m.group(0), lv, 1)
        data = nb.encode('utf-8')
    elif item.filename == 'word/styles.xml':
        # 目次1の章番号のタブ位置を広げる（10章以降の番号が入りきらず崩れるため）
        st = data.decode('utf-8')
        m = re.search(r'<w:style [^>]*w:styleId="10".*?</w:style>', st, re.S)
        assert '<w:tab w:val="left" w:pos="1155"/>' in m.group(0)
        st = st.replace(m.group(0), m.group(0).replace('<w:tab w:val="left" w:pos="1155"/>', '<w:tab w:val="left" w:pos="1365"/>'))
        # 目次3の番号のあとのタブ位置も広げる（手本のままだと「7.11.10」のように番号が7文字になると入りきらず、
        # 名前が右端のページ番号のタブまで飛ばされて「7.11.10・・・・・M01-10 …」と崩れるため）
        m = re.search(r'<w:style [^>]*w:styleId="30".*?</w:style>', st, re.S)
        assert '<w:tab w:val="left" w:pos="2205"/>' in m.group(0)
        st = st.replace(m.group(0), m.group(0).replace('<w:tab w:val="left" w:pos="2205"/>', '<w:tab w:val="left" w:pos="2415"/>'))
        data = st.encode('utf-8')
    zout.writestr(item.filename, data)
for rp, rs, png, svg, n in IMG:
    zout.write(png, f'word/media/toniq_fig{n}.png')
    zout.write(svg, f'word/media/toniq_fig{n}.svg')
zout.close()

# 整形式かどうか
from xml.dom import minidom
minidom.parseString(newdoc.encode('utf-8'))
print('images', len(IMG), 'functions', len(FNAME), 'bytes', os.path.getsize(OUT))
