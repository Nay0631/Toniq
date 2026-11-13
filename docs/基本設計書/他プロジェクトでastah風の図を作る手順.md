# 他のプロジェクトで astah 風の図（SVG）を作る手順

この卒研フォルダで作った「astah 風の見た目」の PlantUML の設定を、別のプロジェクト（GitHub から Clone したリポジトリなど）に持ち込み、基本設計書に使う図を SVG で作るための手順です。Claude Code を使う前提で書いています。

- 対象の図: ユースケース図・ロバストネス図・シーケンス図・クラス図
- 出力: 図ごとの `.puml`（PlantUML のテキスト）と、同じ名前の `.svg`（画像）

---

## 1. 使う資料（この卒研フォルダの中にあるもの）

### 1-1. 必ずコピーするもの

| ファイル | 役割 |
|---|---|
| `PlantUML出力/astah-usecase-style.puml` | ユースケース図の見た目の共通設定 |
| `PlantUML出力/astah-robustness-style.puml` | ロバストネス図の見た目の共通設定 |
| `PlantUML出力/astah-sequence-style.puml` | シーケンス図の見た目の共通設定 |
| `PlantUML出力/astah-class-style.puml` | クラス図の見た目の共通設定 |
| `tools/plantuml.jar` | `.puml` を SVG に変換する本体（約 30MB。Windows 版は Graphviz 入りなので、ほかに入れる物はない） |

### 1-2. 必要なときだけ使うもの

| ファイル | いつ使うか |
|---|---|
| `tools/astah-class2puml/`（`run.bat` と `ClassDiagramToPuml.java`） | クラス図をすでに Astah（`.asta`）で描いていて、それを SVG にしたいとき。Astah Professional がインストールされていないと動かない |

### 1-3. 別に用意するもの

- **Java**（PlantUML を動かすのに必要）。次のどちらかを使う。手順は「1-4」。
  - A. Java（Eclipse Temurin など、版は 11 以上）を PC にインストールする。ほかのメンバーも SVG を作り直すなら、こちらがおすすめ。
  - B. Astah Professional をインストールしてあれば、Astah に入っている Java をそのまま使う。新しく入れる物は無い。
- **Claude Code**（VS Code の拡張機能、または CLI）。

### 1-4. Java の用意のしかた

どちらの方法でも、図の出来上がりは同じです。違うのは、SVG に変換するコマンドで Java をどう指定するか、だけです。

#### A. Java をインストールする（おすすめ）

1. ブラウザで Eclipse Temurin のダウンロードページ（https://adoptium.net/ja/temurin/releases/ ）を開きます。
2. 次のように選び、`.msi` をダウンロードします。
   - オペレーティングシステム: Windows
   - アーキテクチャ: x64
   - パッケージの種類: JRE（JDK でもかまいません）
   - バージョン: 25 - LTS（11 以上ならどれでも動きます）
3. ダウンロードした `.msi` を開き、画面に従ってインストールします。途中の「カスタム セットアップ」で、「Add to PATH」が有効になっていることを確かめます（最初から有効になっています）。これが有効だと、`java` と打つだけで動くようになります。
4. VS Code（またはターミナル）を一度閉じて開き直します。開いたままだと、インストールした Java が見つかりません。
5. ターミナルで `java -version` と入力し、`openjdk version "25…"` のように版が表示されれば完了です。

> コマンドで入れることもできます。ターミナルで `winget search Temurin` と入力して名前を確かめ、`winget install <表示された ID>`（例: `EclipseAdoptium.Temurin.25.JRE`）と入力します。

この方法なら、SVG に変換するコマンドは `java -jar tools/plantuml.jar …` のままで動きます（「3-2」）。

#### B. Astah Professional に入っている Java を使う

Astah Professional には、Astah を動かすための Java 一式（`jre` フォルダ）が入っています。PlantUML もこの Java で動きます（この卒研フォルダの Astah に入っているのは Java 25。Astah の版によって Java の版は違います）。

**ファイルをどこかへコピーしたり、置き直したりする必要はありません。** Astah のインストール先にある `java.exe` を、場所を書いて直接使います。

| 使うもの | 場所 |
|---|---|
| `java.exe` | `<Astah のインストール先>\jre\bin\java.exe` |

- Astah のインストール先は、ふつうは `C:\Program Files\astah-professional\` です。つまり `C:\Program Files\astah-professional\jre\bin\java.exe` を使います。
- インストール先が分からないときは、スタートメニューの Astah を右クリック →「ファイルの場所を開く」で確かめます（ショートカットの場所が開いたら、もう一度右クリック →「ファイルの場所を開く」）。
- この卒研フォルダの場合は、Astah 一式をフォルダごと置いているので `astah_professional\jre\bin\java.exe` です。
- 使えるか確かめるには、ターミナルで次のように入力し、版が表示されれば大丈夫です（11 以上なら PlantUML が動きます）。
  ```
  & "C:\Program Files\astah-professional\jre\bin\java.exe" -version
  ```

注意点:

- `java.exe` だけをコピーしても動きません。同じ `jre` フォルダの中にある `lib` などのファイルも使うためです。どうしてもプロジェクトの中に置きたいときは `jre` フォルダを丸ごとコピーしますが、約 375MB あるのでおすすめしません。git にも入れないでください。
- Astah を更新したりアンインストールしたりすると、この Java の版が変わったり、なくなったりします。
- Claude Code から見ると、Astah のフォルダは「プロジェクトの外」です。そのため、SVG に変換するたびに実行の許可を求められることがあります。何度も変換するなら A の方法のほうが楽です。
- Claude Code が Java を探し回らなくて済むように、リポジトリの `CLAUDE.md` に `java.exe` の場所を書いておきます（「3-2」）。

---

## 2. コピー先のフォルダ構成（例）

リーダーのリポジトリの中に、次のように置く例です。フォルダ名は、リポジトリのルールに合わせて変えてかまいません。変えたときは、`.puml` の中の `!include` の相対パスもそれに合わせます。

```
<リーダーのリポジトリ>/
├─ CLAUDE.md                     ← 図の書き方のルールを追記する（3-2）
├─ tools/
│   └─ plantuml.jar
└─ docs/
    └─ 基本設計書/
        ├─ 基本設計書.md          ← SVG を貼る本文
        └─ 図/
            ├─ astah-usecase-style.puml
            ├─ astah-robustness-style.puml
            ├─ astah-sequence-style.puml
            ├─ astah-class-style.puml
            ├─ ユースケース図/   … .puml と .svg
            ├─ ロバストネス図/
            ├─ シーケンス図/
            └─ クラス図/
```

この構成なら、各図の `.puml` から共通設定へのパスは `../astah-xxx-style.puml` になります。

---

## 3. 操作手順

### 3-1. 作業用のブランチを作り、資料をコピーする
1. エクスプローラーなどで、「1-1」のファイルを「2」の場所にコピーします。

### 3-2. リポジトリの CLAUDE.md にルールを書き足す

次の文面を、リーダーのリポジトリの `CLAUDE.md` に追記します。`CLAUDE.md` が無ければ作ります。追記してよいかもリーダーに確認してください。これで、次回以降はだれが Claude Code を使っても同じ見た目の図になります。

````markdown
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
````

> Java を PC にインストールせず、Astah に入っている Java を使う場合（「1-4」の B）は、上の文面の「SVG への変換」の行の後ろに、次の 1 行も追記します。場所は自分の PC に合わせて書き換えます。
>
> ```markdown
> - この PC には `java` コマンドが無いので、`java` の代わりに `"C:\Program Files\astah-professional\jre\bin\java.exe"` を使う。Java を探し回らない。
> ```
>
> ほかのメンバーの PC では Astah のインストール先が違うことがあります。メンバーごとに場所が違うときは、この 1 行は `CLAUDE.md` ではなく、各自の `CLAUDE.local.md`（git に入れない、自分専用の設定ファイル）に書きます。

### 3-3. Claude Code に図を作ってもらう

Claude Code を開き、次のように依頼します。図は 1 種類ずつ頼み、できた SVG を見て直す、をくり返すと進めやすいです。

- **ユースケース図**
  > `src/` のコードと `README.md` を読んで、このシステムの利用者と機能を洗い出し、CLAUDE.md のルールに従ってユースケース図を `docs/基本設計書/図/ユースケース図/` に作って。SVG にも変換して。どのファイルから何を読み取ったかも報告して。
- **ロバストネス図**（ユースケース 1 つにつき 1 枚）
  > ユースケース「○○機能」について、画面（boundary）・処理（control）・データ（entity）をコードから読み取り、ロバストネス図を作って。
- **シーケンス図**（ユースケース 1 つにつき 1 枚）
  > 「○○機能」のロバストネス図の流れに沿って、関係するクラス・関数の呼び出し順をコードから読み取り、シーケンス図を作って。
- **クラス図**
  > `src/` の主要なクラスについて、属性・操作・関連（継承・保持・呼び出し）をコードから読み取り、クラス図を作って。クラスが多いときは機能ごとに分けて。


---

## 4. 図ごとの書き方（ひな形）

フォルダ構成が「2」のとおりなら、そのまま使えます。

### ユースケース図

```
@startuml
!include ../astah-usecase-style.puml
mainframe **uc** 01_楽曲生成システム_ユースケース図

actor "利用者" as A1

rectangle "楽曲生成システム" {
  usecase "楽曲生成機能" as UC1
  usecase "楽曲再生機能" as UC2
}

A1 -- UC1
A1 -- UC2

@enduml
```

### ロバストネス図

```
@startuml
!include ../astah-robustness-style.puml
mainframe **uc** 101_楽曲再生機能_ロバストネス図

actor "利用者" as A1
boundary "楽曲再生画面" as B1
control "再生する楽曲を選択" as C1
control "楽曲を再生" as C2
entity "楽曲データ" as E1

A1 --> B1
B1 --> C1
C1 --> C2
C2 --> E1

@enduml
```

### シーケンス図

```
@startuml
!include ../astah-sequence-style.puml
mainframe sd 201_楽曲再生機能_シーケンス図

actor ":利用者" as L1
boundary ":楽曲再生画面" as L2
control ":楽曲を再生" as L3

L1 -> L2 : 再生する楽曲を押下する()
activate L2
L2 -> L3 : 楽曲を再生する()
activate L3
deactivate L3
deactivate L2

@enduml
```

### クラス図

```
@startuml
!include ../astah-class-style.puml
mainframe **pkg**

class "楽曲再生画面" as B1 <<boundary>> {
  {method} <U+002B> 再生する楽曲を押下する()
}
class "楽曲を再生" as C1 <<control>> {
  {field} <U+002D> 再生位置 : int
  {method} <U+002B> 楽曲を再生する()
}

B1 --> C1

@enduml
```

---

## 5. コードを読み取るだけで図を作れるか

**作れます。** 共通設定とルール（3-2）があれば、Claude Code にコードを読ませるだけで、この見た目の `.puml` と `.svg` ができます。ただし、図の種類によって正確さが違うので、人による確認は欠かせません。

| 図 | コードからの読み取りやすさ | 注意点 |
|---|---|---|
| クラス図 | 高い | クラス・属性・メソッド・継承はコードにそのまま書いてあるので、ほぼ正確。クラスが多いと 1 枚に収まらないので、機能ごとに分ける。 |
| シーケンス図 | 中くらい | 関数の呼び出し順は追える。ただし、非同期処理・イベント・画面のフレームワークの内部の動きは、推測が入りやすい。 |
| ロバストネス図 | 中くらい | 画面＝boundary、処理＝control、データ・DB＝entity と読み替える。どこまでを 1 つの「処理」とみなすかは設計の判断なので、意図と合っているか確認が要る。 |
| ユースケース図 | 低め | 「利用者が何をしたいか」は、コードには直接書かれていない。画面・ルーティング・README などからの推測になるので、要件（仕様書・議事録・Issue など）もいっしょに読ませると精度が上がる。 |

覚えておくこと:

- コードから作った図は、「今のコードがどうなっているか」の図です。基本設計書は本来「こう作る」という設計を書くものなので、要件とずれていないか、リーダーと確認してください。
- 依頼するときは「どのファイルから読み取ったか」「推測で補ったところはどこか」も報告させると、確認が楽になります。
- 図の並び（どの箱がどこに来るか）は PlantUML が自動で決めます。Astah のように自由に配置はできません。

---

## 6. astah と比べて、見た目が違うところ

共通設定で、色・線・文字の太さ・枠（uc / sd / pkg）はそろえています。ただし、PlantUML の作りのため、次の点は同じにできません。

- 図の部品の位置は自動で決まる（Astah で手で並べた配置は再現できない）。
- ロバストネス図のアイコンは Astah より小さく、矢印が名前の文字の近くに向かう。
- 文字の大きさや、枠の名札の形がわずかに違う。
