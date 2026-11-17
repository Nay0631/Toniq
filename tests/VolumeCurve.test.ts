import { describe, it, expect } from "vitest";
import { VOLUME_UNITY, volumeToDb, dbToVolume, volumeFromLegacy, panLabel } from "../src/engine/VolumeCurve";
import { defaultState } from "../src/engine/AppState";

// 以前のカーブ（値に比例。100 で 0dB）
const legacyDb = (v: number) => 20 * Math.log10(v / 100);

describe("フェーダーのカーブ（volumeToDb）", () => {
  it("75 で 0dB、100 で +5dB、0 で無音", () => {
    expect(VOLUME_UNITY).toBe(75);
    expect(volumeToDb(75)).toBeCloseTo(0, 6);
    expect(volumeToDb(100)).toBeCloseTo(5, 1);
    expect(volumeToDb(0)).toBe(-Infinity);
  });

  it("下げるほど小さくなり、半分で −7dB、1/4 で −19dB ほど", () => {
    expect(volumeToDb(50)).toBeCloseTo(-7.0, 1);
    expect(volumeToDb(25)).toBeCloseTo(-19.1, 1);
    for (let v = 1; v < 100; v++) expect(volumeToDb(v + 1)).toBeGreaterThan(volumeToDb(v));
  });

  it("dbToVolume は逆の換算（目盛りの位置）", () => {
    expect(dbToVolume(0)).toBeCloseTo(75, 6);
    for (const db of [-24, -12, -6, 3]) expect(volumeToDb(dbToVolume(db))).toBeCloseTo(db, 6);
  });
});

describe("以前のカーブで保存した音量の読み替え（volumeFromLegacy）", () => {
  it("同じ大きさで鳴る値になる（ずれは整数に丸める半目盛りの分だけ。初期値のあたりの 50 以上では 0.2dB 以内）", () => {
    for (let v = 5; v <= 100; v++) {
      const now  = volumeFromLegacy(v);
      const diff = Math.abs(volumeToDb(now) - legacyDb(v));
      expect(diff, `以前の ${v}`).toBeLessThanOrEqual(40 * Math.log10(1 + 0.5 / (now - 0.5)) + 1e-9);
      if (v >= 50) expect(diff, `以前の ${v}`).toBeLessThan(0.2);
    }
  });

  it("以前の最大（100 = 0dB）は 75、0 は 0。範囲の外の値は収める", () => {
    expect(volumeFromLegacy(100)).toBe(75);
    expect(volumeFromLegacy(0)).toBe(0);
    expect(volumeFromLegacy(150)).toBe(75);
    expect(volumeFromLegacy(-10)).toBe(0);
  });

  it("音量の初期値は、以前の初期値と同じ大きさ", () => {
    const legacy = { drum: 80, chord: 65, bass: 70, arp: 60, pad: 50, signature: 60, melody: 75, counter: 65, perc: 55, fx: 55 };
    for (const [part, v] of Object.entries(legacy)) {
      expect(defaultState.volumes[part as keyof typeof legacy], part).toBe(volumeFromLegacy(v));
    }
  });
});

describe("定位の表示（panLabel）", () => {
  it("中央は C、左は L、右は R", () => {
    expect(panLabel(0)).toBe("C");
    expect(panLabel(-30)).toBe("L30");
    expect(panLabel(100)).toBe("R100");
  });
});
