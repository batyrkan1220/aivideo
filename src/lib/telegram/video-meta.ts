import "server-only";

/** The video's real size and length (and a small cover), so Telegram shows it in its own proportions. */
export async function videoMeta(blob: Blob) {
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ffmpegLog } = await import("@/lib/templates/lite-preview");
  const dir = await mkdtemp(join(tmpdir(), "tg-"));
  try {
    const src = join(dir, "v.mp4"), thumb = join(dir, "t.jpg");
    await writeFile(src, new Uint8Array(await blob.arrayBuffer()));
    const info = await ffmpegLog(["-hide_banner", "-y", "-loglevel", "info", "-i", src, "-ss", "0.5", "-frames:v", "1",
      "-vf", "scale='if(gt(iw,ih),320,-2)':'if(gt(iw,ih),-2,320)'", "-q:v", "4", thumb], 60_000);
    const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(info);
    const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info);
    // A rotated phone video: width and height swap.
    const rot = /rotation of -?(90|270)|rotate\s*:\s*(90|270)/.test(info);
    if (!m) return undefined;
    const [w, h] = rot ? [Number(m[2]), Number(m[1])] : [Number(m[1]), Number(m[2])];
    const thumbBytes = await readFile(thumb).catch(() => null);
    return { width: w, height: h, duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
      thumb: thumbBytes ? new Blob([new Uint8Array(thumbBytes)], { type: "image/jpeg" }) : null };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
