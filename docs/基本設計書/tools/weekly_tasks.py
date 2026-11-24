# 週報の材料をガントチャートだけから集める（読むだけ。手順は .claude/skills/weekly-report/SKILL.md）
#
#   - 基準の日（省略時は今日）から「先週」「今週」（どちらも月曜〜日曜）を決める
#   - ガントチャート（シート「2026」）から、担当者ごとに先週・今週にかかるタスク（開始〜終了が週と重なる行）と進捗
#   - 進捗を 100% にするタスク：先週にかかり、先週の日曜までに終わる予定で、進捗が 100% でない行
#     （終わりが今週以降のタスクはまだ途中なので変えない）。--plan で gantt_apply.ps1 の計画（D 列を 1）を書く
#   - 先週より前に終わる予定なのに進捗が 100% でない行（自動では変えない。ユーザーに知らせる）
#   - 今週のタスクがない担当者には、次に始まるタスク
#
# 使い方（リポジトリのルートで）:
#   [Console]::OutputEncoding = [Text.Encoding]::UTF8; py docs/基本設計書/tools/weekly_tasks.py
#   py docs/基本設計書/tools/weekly_tasks.py --date 2026-11-24          # 基準の日を指定する
#   py docs/基本設計書/tools/weekly_tasks.py --plan <計画.json>         # 進捗を 100% にする計画を書く
#   py docs/基本設計書/tools/weekly_tasks.py --xlsx <別の xlsx>         # 写しを読む
#   py docs/基本設計書/tools/weekly_tasks.py --json <出力先.json>       # 結果を JSON でも出す
import datetime
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True  # tools/ に __pycache__ を作らない
import gantt_check as gc  # noqa: E402  ガントチャートの読み方は gantt_check.py と共通

MEMBERS = gc.MEMBERS
ALL = "全員"
WEEKDAYS = "月火水木金土日"


def fmt(d):
    return f"{d:%m/%d}（{WEEKDAYS[d.weekday()]}）"


def arg(name):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else None


def gantt_tasks(path):
    rows, _ = gc.read_sheet(path)
    out = []
    for title, sec in gc.sections(rows).items():
        for x in sec["rows"]:
            if x["hidden"] or not x["B"] or not x["C"] or not x["E"] or not x["F"]:
                continue
            try:
                e, f = datetime.date.fromisoformat(x["E"]), datetime.date.fromisoformat(x["F"])
            except ValueError:
                continue
            try:
                prog = float(x["D"]) if x["D"] else 0.0
            except ValueError:
                prog = 0.0
            out.append({"row": x["row"], "section": title, "task": x["B"], "who": x["C"],
                        "start": e.isoformat(), "end": f.isoformat(), "progress": prog})
    return out


def main():
    today = datetime.date.fromisoformat(arg("--date")) if arg("--date") else datetime.date.today()
    this_mon = today - datetime.timedelta(days=today.weekday())
    this_sun = this_mon + datetime.timedelta(days=6)
    last_mon = this_mon - datetime.timedelta(days=7)
    last_sun = this_mon - datetime.timedelta(days=1)
    path = arg("--xlsx") or gc.find_xlsx()
    tasks = gantt_tasks(path)

    def overlap(t, a, b):
        return t["start"] <= b.isoformat() and t["end"] >= a.isoformat()

    # 進捗を 100% にする行（先週にかかり、先週の日曜までに終わる予定で、100% でない）
    to_done = [t for t in tasks if overlap(t, last_mon, last_sun) and t["end"] <= last_sun.isoformat() and t["progress"] < 1]
    # 先週より前に終わる予定なのに 100% でない行（自動では変えない）
    older = [t for t in tasks if t["end"] < last_mon.isoformat() and t["progress"] < 1]

    print(f"基準の日: {today}（{WEEKDAYS[today.weekday()]}）")
    print(f"先週: {fmt(last_mon)}〜{fmt(last_sun)}　今週: {fmt(this_mon)}〜{fmt(this_sun)}")
    print(f"ガントチャート: {os.path.basename(path)}")
    if tasks:
        print(f"ガントチャートの期間: {min(t['start'] for t in tasks)}〜{max(t['end'] for t in tasks)}")

    print(f"\n[進捗を 100% にする] 先週の日曜までに終わる予定の先週のタスクで、100% でない行: {len(to_done)} 行")
    for t in to_done:
        print(f"  {t['row']} 行 {t['task']}（{t['who']}）{t['start'][5:]}〜{t['end'][5:]} 進捗 {t['progress']:.0%} → 100%")
    print(f"[要確認] 先週より前に終わる予定なのに 100% でない行（自動では変えない）: {len(older)} 行")
    for t in older:
        print(f"  {t['row']} 行 {t['task']}（{t['who']}）{t['start'][5:]}〜{t['end'][5:]} 進捗 {t['progress']:.0%}")

    if arg("--plan"):
        plan = {"set": [{"row": t["row"], "col": "D", "value": 1} for t in to_done]}
        with open(arg("--plan"), "w", encoding="utf-8") as f:
            json.dump(plan, f, ensure_ascii=False, indent=1)
        print(f"計画: {arg('--plan')}（{len(to_done)} 行。0 行なら当てなくてよい）")

    result = {"today": today.isoformat(), "last_week": [last_mon.isoformat(), last_sun.isoformat()],
              "this_week": [this_mon.isoformat(), this_sun.isoformat()], "xlsx": os.path.basename(path),
              "to_done": to_done, "older_unfinished": older, "members": {}}

    def show(title, items):
        print(f"  ▼ {title}: {len(items)} 件")
        by_sec = {}
        for t in items:
            by_sec.setdefault(t["section"], []).append(t)
        for sec, ts in by_sec.items():
            done = sum(1 for t in ts if t["progress"] >= 1)
            print(f"    [{sec}] {len(ts)} 件（100% {done} 件）")
            for t in ts:
                mark = "（全員）" if t["who"] == ALL else ""
                print(f"      {t['row']} 行 {t['task']}{mark} {t['start'][5:]}〜{t['end'][5:]} 進捗 {t['progress']:.0%}")

    for m in MEMBERS:
        mine = [t for t in tasks if t["who"] in (m, ALL)]
        last = [t for t in mine if overlap(t, last_mon, last_sun)]
        this = [t for t in mine if overlap(t, this_mon, this_sun)]
        ends = [t for t in this if t["end"] <= this_sun.isoformat()]
        nxt = sorted((t for t in mine if t["start"] > this_sun.isoformat()), key=lambda t: t["start"])[:5]
        result["members"][m] = {"last_week": last, "this_week": this, "next": nxt}
        print(f"\n■ {m}")
        show("先週にかかるタスク", last)
        show("今週にかかるタスク", this)
        print(f"  ▼ 今週のうちに終わる予定: {len(ends)} 件・今週より後まで続く: {len(this) - len(ends)} 件")
        if nxt:
            print("  ▼ 今週より後に始まるタスク（早い順に5件）: " + "、".join(f"{t['task']}（{t['start'][5:]}〜）" for t in nxt))

    if arg("--json"):
        with open(arg("--json"), "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)
        print(f"\nJSON: {arg('--json')}")


if __name__ == "__main__":
    main()
