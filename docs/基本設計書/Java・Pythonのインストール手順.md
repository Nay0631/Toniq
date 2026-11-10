# Java・Python のインストール手順

基本設計書の図と docx を作るために必要です。PC ごとに1回だけ行います。どちらも**最新版**を入れます。

| ソフト | 何に必要か |
|---|---|
| Java | 図（.puml）を SVG・PNG に変換する（`tools/plantuml.jar` を動かす）。`/update-diagrams` と `/build-design-doc` で使う |
| Python | 仕様書.md を docx に変換する（`tools/build_docx.py` を動かす）。`/build-design-doc` で使う |

docx を作るには、ほかに Microsoft Word（365 版）も必要です。

## 手順（VS Code のターミナルで行う）

1. VS Code でターミナルを開く（メニューの「ターミナル」→「新しいターミナル」）。
2. 最新版の番号を調べる。
   ```
   winget search --id EclipseAdoptium.Temurin --source winget
   winget search --id Python.Python.3 --source winget
   ```
   - Java：`EclipseAdoptium.Temurin.<番号>.JRE` のうち、番号が一番大きいもの。
   - Python：`Python.Python.3.<番号>` のうち、番号が一番大きいもの（一覧は番号の順に並ばないので、`3.9` より `3.14` のほうが新しいことに注意）。
3. 2 で調べた ID を入れて実行する（途中で確認が出たら `Y`、管理者の許可を求められたら「はい」）。2026年11月時点の最新版で書くと次のとおり。
   ```
   winget install EclipseAdoptium.Temurin.27.JRE
   winget install Python.Python.3.14
   ```
4. **VS Code をいったん閉じて開き直す**（開き直さないと、新しく入れたソフトが見つからない）。
5. ターミナルで次を実行し、3 で入れた版数が表示されれば完了。
   ```
   java -version
   py --version
   ```

## うまくいかないとき

- `winget` が見つからない：Microsoft Store で「アプリ インストーラー」を更新する。
- `java` / `py` が見つからない：VS Code を開き直す。それでもだめなら PC を再起動する。
- `java -version` に古い版が出る：前に入れた Java が先に見つかっている。Windows の「設定」→「アプリ」で古い Java をアンインストールする。
- `python` と入力すると Microsoft Store が開く：これは Windows の仮のコマンドなので気にしなくてよい（スクリプトは `py` を使う）。
