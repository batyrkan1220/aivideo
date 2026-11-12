import { describe, expect, it } from "vitest";
import { parseStats, planCuts, type ClipStats } from "@/lib/montage/plan";

const flat = (duration: number, hot?: [number, number]): ClipStats => ({
  duration,
  samples: Array.from({ length: Math.floor(duration * 2) }, (_, i) => ({ t: i / 2, motion: hot && i / 2 >= hot[0] && i / 2 < hot[1] ? 0.9 : 0.05, light: 120 })),
});

describe("montage plan", () => {
  it("takes the liveliest window of a clip", () => {
    const cuts = planCuts([flat(20, [12, 14])], "dynamic", 1.2);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].start).toBeGreaterThanOrEqual(11.5);
    expect(cuts[0].start).toBeLessThan(13);
  });
  it("every clip gets a cut, in order, about the asked length in total", () => {
    const cuts = planCuts([flat(10), flat(30), flat(5)], "smooth", 30);
    expect(new Set(cuts.map((c) => c.clip))).toEqual(new Set([0, 1, 2]));
    expect(cuts.map((c) => c.clip)).toEqual([...cuts.map((c) => c.clip)].sort());
    const total = cuts.reduce((a, c) => a + c.len, 0);
    expect(total).toBeGreaterThan(24);
    expect(total).toBeLessThanOrEqual(33);
    for (const c of cuts) expect(c.start + c.len).toBeLessThanOrEqual([10, 30, 5][c.clip]);
  });
  it("short footage: the video is shorter than asked, cuts do not overlap", () => {
    const cuts = planCuts([flat(6)], "dynamic", 60);
    const s = cuts.map((c) => c.start).sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeGreaterThanOrEqual(1.2);
    expect(cuts.reduce((a, c) => a + c.len, 0)).toBeLessThanOrEqual(6);
  });
  it("parses ffmpeg metadata output", () => {
    const log = "frame:0 pts:0 pts_time:0\nlavfi.signalstats.YAVG=100.5\nlavfi.signalstats.YDIF=5\nframe:1 pts:1 pts_time:0.5\nlavfi.signalstats.YAVG=20\nlavfi.signalstats.YDIF=25\n";
    expect(parseStats(log)).toEqual([{ t: 0, motion: 0.2, light: 100.5 }, { t: 0.5, motion: 1, light: 20 }]);
  });
});
