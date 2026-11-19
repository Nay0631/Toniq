# ガントチャート（ガントチャート(アプリオリ)*.xlsx のシート「2026」）を仕様書.md と突き合わせる（読むだけ。xlsx は書き換えない）
#
#   - 2.機能設計 / 7.各種設計図（クラス図・ロバストネス図・シーケンス図）に、仕様書の 5.1 の機能が全部あるか
#   - 3.画面設計 に、仕様書の 10.1 の画面が全部あるか
#   - 4.データベース設計 に、仕様書の 12.1 のテーブルが全部あるか
#   - 7.各種設計図（ユースケース図・ユースケース記述）の行と、仕様書のシステム（5.1 のグループ）
#   - 各節の担当者（C列）の数と、開始・終了（E列・F列）の組の数（行を足すときの割り振りに使う）
#   - 「（xxxxx）」「（T_xxxx)」が残っている行、表記を直す名前（「西園」など）
#
# 機能IDと、ガントチャートでの別名・英名の対応は gantt_names.tsv（機能を足したらここにも足す）。
#
# 使い方（リポジトリのルートで）:
#   [Console]::OutputEncoding = [Text.Encoding]::UTF8; py docs/基本設計書/tools/gantt_check.py
#   py docs/基本設計書/tools/gantt_check.py --json <出力先.json>   # 結果を JSON でも出す（計画を作るとき用）
#   py docs/基本設計書/tools/gantt_check.py --xlsx <別の xlsx>     # 試しに当てた写しを確かめる
import datetime
import glob
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
DOC = os.path.dirname(HERE)
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
MT = "{%s}" % NS["m"]
SHEET = "2026"
WRONG_NAMES = {"西園": "西薗"}  # 直す表記
MEMBERS = ["根井", "西薗", "小手川"]

# 突き合わせる節（B列の見出しの頭）
FUNC_SECTIONS = ["2.機能設計", "7.各種設計図（クラス図）", "7.各種設計図（ロバストネス図）", "7.各種設計図（シーケンス図）"]
SCREEN_SECTION = "3.画面設計"
SYSTEM_SECTIONS = ["7.各種設計図（ユースケース図）", "7.各種設計図（ユースケース記述）"]
DB_SECTION = "4.データベース設計"
NAME_ONLY_SECTIONS = ["8.プログラミング", "9.各種テスト"]  # 名前の違い・仕様書にない行だけ確かめる（行の追加はしない）


def find_xlsx():
    files = [f for f in glob.glob(os.path.join(DOC, "ガントチャート*.xlsx")) if not os.path.basename(f).startswith("~$")]
    if len(files) != 1:
        sys.exit(f"[NG] ガントチャートの xlsx が1つに決まりません: {files}")
    return files[0]


def serial_to_date(v):
    return (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(float(v)))).isoformat()


def read_sheet(path):
    z = zipfile.ZipFile(path)
    ss = ["".join(t.text or "" for t in si.iter(MT + "t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid = next(s.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id") for s in wb.iter(MT + "sheet") if s.get("name") == SHEET)
    target = next(r.get("Target") for r in rels if r.get("Id") == rid)
    root = ET.fromstring(z.read("xl/" + target.lstrip("/").replace("xl/", "")))
    rows = []
    for row in root.find("m:sheetData", NS):
        r = int(row.get("r"))
        cells = {}
        for c in row:
            col = re.match(r"[A-Z]+", c.get("r")).group()
            if col not in ("B", "C", "D", "E", "F"):
                continue
            v = c.find("m:v", NS)
            f = c.find("m:f", NS)
            val = v.text if v is not None else ""
            if c.get("t") == "s" and val:
                val = ss[int(val)]
            elif col in ("E", "F") and val and f is None:
                val = serial_to_date(val)
            cells[col] = (val or "").strip()
        rows.append({"row": r, "hidden": row.get("hidden") == "1", **{k: cells.get(k, "") for k in "BCDEF"}})
    return rows, ss


def sections(rows):
    out, cur = {}, None
    for x in rows:
        if x["row"] < 8:
            continue
        b = x["B"]
        if re.match(r"^\d+\.", b) and not x["C"] and not x["E"]:
            cur = b
            out[cur] = {"header": x["row"], "rows": []}
        elif cur:
            out[cur]["rows"].append(x)
    return out


def read_spec():
    text = open(os.path.join(DOC, "仕様書.md"), encoding="utf-8").read()
    s51 = text[text.index("### 5.1"):text.index("### 5.2")]
    funcs = re.findall(r"^\| ([A-Z]\d{2}-\d+) \| ([^|]+?) \|", s51, re.M)
    systems = re.findall(r"^\*\*([A-Z]\d{2})_(.+?)\*\*", s51, re.M)
    s101 = text[text.index("### 10.1"):text.index("### 10.2")]
    screens = re.findall(r"^\| ([A-Z]+-\d{3}) \| ([^|]+?) \|", s101, re.M)
    s121 = text[text.index("### 12.1"):text.index("### 12.2")]
    tables = [(tid, re.sub(r"（追加）$", "", n.strip())) for tid, n in re.findall(r"^\| (T\d{2}) \| ([^|]+?) \|", s121, re.M)]
    return funcs, systems, screens, tables


def read_names():
    names = {}
    with open(os.path.join(HERE, "gantt_names.tsv"), encoding="utf-8") as f:
        next(f)
        for line in f:
            fid, name, alias, en = (line.rstrip("\n").split("\t") + ["", "", "", ""])[:4]
            for n in [name] + [a for a in alias.split(";") if a]:
                names[n] = {"id": fid, "name": name, "en": en}
    return names


def task_name(b):
    """「7-01.BPM選択機能 （xxxxx）」→ 番号 "01" と名前 "BPM選択" """
    m = re.match(r"^\d+-(\d+)\.\s*(.+?)\s*(?:（.*)?$", b)
    if not m:
        return None, None
    name = re.sub(r"(機能|画面)$", "", m.group(2).strip())
    return m.group(1), name


def main():
    path = sys.argv[sys.argv.index("--xlsx") + 1] if "--xlsx" in sys.argv else find_xlsx()
    rows, ss = read_sheet(path)
    secs = sections(rows)
    funcs, systems, screens, tables = read_spec()
    names = read_names()
    result = {"xlsx": os.path.relpath(path, DOC), "sections": {}, "wrong_names": {}, "placeholders": []}
    print(f"ガントチャート: {os.path.basename(path)}（シート {SHEET}）")

    # 対応表にない仕様書の機能
    missing_tsv = [f"{fid} {n}" for fid, n in funcs if n.strip() not in names]
    print("[OK] gantt_names.tsv に仕様書の機能が全部ある" if not missing_tsv else f"[NG] gantt_names.tsv にない機能（英名を決めて足す）: {missing_tsv}")

    def summary(title, sec):
        vis = [x for x in sec["rows"] if not x["hidden"] and x["B"]]
        assignees, pairs = {}, {}
        for x in vis:
            if x["C"]:
                assignees[x["C"]] = assignees.get(x["C"], 0) + 1
            if x["E"] and x["F"]:
                k = f"{x['E']}〜{x['F']}"
                pairs[k] = pairs.get(k, 0) + 1
        nums = [int(n) for n, _ in (task_name(x["B"]) for x in vis) if n]
        last = max((x["row"] for x in vis), default=sec["header"])
        info = {"header": sec["header"], "last_row": last, "next_no": (max(nums) + 1) if nums else 1,
                "assignees": assignees, "pairs": pairs, "missing": []}
        hidden = [x["row"] for x in sec["rows"] if x["hidden"]]
        print(f"\n■ {title}（見出し {sec['header']} 行・最後の行 {last} 行・次の番号 {info['next_no']:02d}"
              + (f"・隠した雛形の行 {hidden[0]}〜{hidden[-1]}" if hidden else "") + "）")
        print("  担当者: " + "、".join(f"{k} {v}" for k, v in sorted(assignees.items(), key=lambda t: -t[1])))
        print("  開始〜終了の組: " + "、".join(f"{k} {v}" for k, v in sorted(pairs.items())))
        return vis, info

    for title in FUNC_SECTIONS:
        sec = next((v for k, v in secs.items() if k.startswith(title)), None)
        if not sec:
            print(f"\n[NG] 節が見つかりません: {title}")
            continue
        vis, info = summary(title, sec)
        have = set()
        for x in vis:
            _, n = task_name(x["B"])
            if n in names:
                have.add(names[n]["id"] if names[n]["id"] != "-" else n)
            elif n:
                print(f"  [?] 対応表にない行: {x['row']} 行 {x['B']}")
        miss = [(fid, n.strip(), names.get(n.strip(), {}).get("en", "")) for fid, n in funcs if fid not in have]
        info["missing"] = [{"id": a, "name": b, "en": c} for a, b, c in miss]
        print("  [OK] 仕様書の機能が全部ある" if not miss else "  [要追加] " + "、".join(f"{a} {b}（{c}）" for a, b, c in miss))
        result["sections"][title] = info

    sec = next((v for k, v in secs.items() if k.startswith(SCREEN_SECTION)), None)
    if sec:
        vis, info = summary(SCREEN_SECTION, sec)
        def screen_key(n):  # 「設定画面（追加）」「シンプルモード生成完了画面」→「設定」「シンプルモード生成後」
            n = re.sub(r"\s|（.*?）", "", n or "")
            return re.sub(r"画面$", "", n).replace("生成完了", "生成後")

        have = {screen_key(task_name(x["B"])[1]) for x in vis}
        miss = [(sid, n.strip()) for sid, n in screens if screen_key(n) not in have]
        info["missing"] = [{"id": a, "name": b} for a, b in miss]
        print("  [OK] 仕様書の画面が全部ある" if not miss else "  [要確認] ガントチャートに見当たらない画面（名前の違いだけなら追加しない）: " + "、".join(f"{a} {b}" for a, b in miss))
        result["sections"][SCREEN_SECTION] = info

    sec = next((v for k, v in secs.items() if k.startswith(DB_SECTION)), None)
    if sec:
        vis, info = summary(DB_SECTION, sec)
        have = set()
        for x in vis:
            m = re.match(r"^\d+-\d+\.\s*(\S+?)\s*テーブル", x["B"])
            if not m:
                continue
            n = m.group(1)
            if n in names:
                have.add(names[n]["id"] if names[n]["id"] != "-" else n)
            else:
                print(f"  [?] 対応表にない行: {x['row']} 行 {x['B']}")
        miss = [(tid, n, next((v["en"] for v in names.values() if v["id"] == tid), "")) for tid, n in tables if tid not in have]
        info["missing"] = [{"id": a, "name": b, "en": c} for a, b, c in miss]
        hidden = [x["row"] for x in sec["rows"] if x["hidden"]]
        print("  [OK] 仕様書のテーブルが全部ある" if not miss else "  [要追加] " + "、".join(f"{a} {b}（{c or '英名を gantt_names.tsv に足す'}）" for a, b, c in miss)
              + (f"\n  → 隠した雛形の行（{hidden[0]} 行〜）に書いて表示する" if miss and hidden else ""))
        result["sections"][DB_SECTION] = info

    for title in SYSTEM_SECTIONS:
        sec = next((v for k, v in secs.items() if k.startswith(title)), None)
        if not sec:
            continue
        vis, info = summary(title, sec)
        print(f"  仕様書のシステム {len(systems)} 個: " + "、".join(f"{a}_{b}" for a, b in systems))
        print(f"  ガントチャートの行 {len(vis)} 個: " + "、".join(x["B"] for x in vis))
        result["sections"][title] = info

    # 仕様書と名前が違う行（gantt_names.tsv の別名で書いてある行）と、仕様書にない行（ID が「-」の行）
    renames, deletes = [], []
    for title, sec in secs.items():
        if not any(title.startswith(t) for t in FUNC_SECTIONS + NAME_ONLY_SECTIONS + SYSTEM_SECTIONS + [SCREEN_SECTION, DB_SECTION]):
            continue
        for x in sec["rows"]:
            if x["hidden"] or not x["B"]:
                continue
            if title.startswith(DB_SECTION):
                m = re.match(r"^\d+-\d+\.\s*(\S+?)\s*テーブル", x["B"])
                n = m.group(1) if m else None
            else:
                n = task_name(x["B"])[1]
            if n not in names:
                continue
            e = names[n]
            if e["id"] == "-":
                deletes.append({"row": x["row"], "B": x["B"], "section": title})
            elif e["name"] != n and not title.startswith(DB_SECTION):  # テーブルは実体の英名（chord_progressions など）で書く決まり
                renames.append({"row": x["row"], "B": x["B"], "new": x["B"].replace(n, e["name"], 1)})
    result["renames"], result["deletes"] = renames, deletes
    print("\n" + ("[OK] 仕様書と名前が違う行はない" if not renames else f"[要改名] 仕様書と名前が違う行: {len(renames)} 行"))
    for r in renames:
        print(f"  {r['row']} 行 {r['B']} → {r['new']}")
    print(("[OK] 仕様書にない行はない" if not deletes else f"[要削除] 仕様書にない（外した）機能・画面・テーブルの行: {len(deletes)} 行"))
    for d in deletes:
        print(f"  {d['row']} 行 {d['B']}")

    # 直す表記
    for wrong, right in WRONG_NAMES.items():
        hit = [x["row"] for x in rows if wrong in x["C"] or wrong in x["B"]]
        result["wrong_names"][wrong] = hit
        print(f"\n{'[OK]' if not hit else '[要修正]'} 「{wrong}」→「{right}」: " + (f"{len(hit)} 行（{hit[0]}〜{hit[-1]} 行）" if hit else "なし"))

    # （xxxxx）・（T_xxxx) の残り（隠した雛形の行は数えない）
    ph = [x for x in rows if not x["hidden"] and re.search(r"x{4,}", x["B"])]
    result["placeholders"] = [{"row": x["row"], "B": x["B"]} for x in ph]
    print(("[OK] （xxxxx）・（T_xxxx) は残っていない" if not ph else f"[要記入] （xxxxx）・（T_xxxx) が残っている行: {len(ph)} 行（{ph[0]['row']}〜{ph[-1]['row']} 行）"))
    unknown = [x["B"] for x in ph if task_name(x["B"])[1] not in names and "テーブル" not in x["B"]]
    if unknown:
        print("  [?] 対応表にない名前（英名を決めて gantt_names.tsv に足す）: " + "、".join(unknown))

    if "--json" in sys.argv:
        out = sys.argv[sys.argv.index("--json") + 1]
        with open(out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)
        print(f"\nJSON: {out}")


if __name__ == "__main__":
    main()
