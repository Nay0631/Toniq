# CLAUDE.local.md を別の環境で使う手順

## 1. CLAUDE.local.md を配置する

`CLAUDE.local.md` は Git で管理しないため、リポジトリとは別の場所（クラウドストレージなど）で保管しておく。
環境ごとに、保管している最新の `CLAUDE.local.md` をリポジトリのルートに置く。

```
<リポジトリのルート>\CLAUDE.local.md
```

## 2. Git の対象から外す

共有の `.gitignore` は変えず、自分の環境でだけ効く `.git/info/exclude` に追加する。

`.git` はリポジトリのルートにある隠しフォルダ。追加するファイルは次の場所にある。

```
<リポジトリのルート>\.git\info\exclude
```

このファイルの末尾に次の1行を追加する。

```
CLAUDE.local.md
```
