// テストを実行する（npm test。引数はそのまま vitest に渡す：npm test -- tests/SongLibrary.test.ts など）。
// Windows で作業フォルダのドライブ文字が小文字（c:\…。VS Code のターミナルなど）だと、vitest が自分のモジュールを
// 別のパスとして2回読み込み「Cannot read properties of undefined (reading 'config')」で失敗する。
// ドライブ文字を大文字にそろえてから vitest を起動する
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const upper = p => p.replace(/^[a-z]:/, d => d.toUpperCase());
const root = upper(join(dirname(fileURLToPath(import.meta.url)), ".."));
const bin  = join(root, "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(process.execPath, [bin, "run", ...process.argv.slice(2)], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
