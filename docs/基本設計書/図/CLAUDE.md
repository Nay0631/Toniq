## 設計書の図（PlantUML）

- 図は `docs/基本設計書/図/<図の種類>/` に PlantUML（`.puml`、UTF-8）で書き、同じ名前の `.svg` を同じフォルダに出力する。PNG は使わない。
- `.puml` を追加・修正したら、対応する `.svg` も作り直す。変換後に `.svg` の中を「Syntax Error」で検索して、エラーが無いことを確かめる。
- 見た目は astah 風にそろえる。`@startuml` の直後で、図の種類ごとの共通設定を `!include` する。図の中に `skinparam` を書かない。
  - ユースケース図: `!include ../astah-usecase-style.puml`、枠は `mainframe **uc** <図名>`
  - ロバストネス図: `!include ../astah-robustness-style.puml`、枠は `mainframe **uc** <図名>`
  - シーケンス図: `!include ../astah-sequence-style.puml`、枠は `mainframe sd <図名>`
  - クラス図: `!include ../astah-class-style.puml`、枠は `mainframe **pkg**`
- `title` は使わない（枠に図名を入れる）。
- 共通設定ファイル（`astah-*.puml`）には `@startuml` / `@enduml` を書かない。
- ユースケース図: 利用者は `actor "利用者" as A1`。システムの範囲は `rectangle "<システム名>" { usecase "<機能名>" as UC1 }`。利用者とユースケースは `A1 -- UC1`（矢印なし）でつなぐ。
- ロバストネス図: `actor` / `boundary`（画面）/ `control`（処理）/ `entity`（データ）を使う。線は向きのある矢印 `-->` で、利用者 → 画面 → 処理 → データ の向きに書く。
- シーケンス図: 参加者の表示名は先頭に「:」を付ける（`actor ":利用者" as L1`）。メッセージ名は `操作名()` の形にする（例: `L1 -> L2 : 再生ボタンを押下する()`）。メッセージを受け取った側を `activate` / `deactivate` する。`alt` などの分岐の中で `activate` したものは、その分岐の中で `deactivate` する。
- クラス図: `class "クラス名" as C1 <<control>> { ... }` のようにステレオタイプを付ける。操作は `{method} <U+002B> 操作名()` と書く（`+ ` とそのまま書くと「+」の後ろの空白が消える）。`hide empty members` は書かない。
- SVG への変換（リポジトリのルートで実行）:
  `java -jar tools/plantuml.jar -tsvg -charset UTF-8 "docs/基本設計書/図/**/*.puml"`
  （`図/**.puml` と書くと下の階層のファイルが見つからず「No diagram found」になるので、必ず `**/*.puml` と書く。共通設定ファイルについて「no image」という警告が出るが問題ない）
