// Build step: make sure node_modules/ffmpeg-static/ffmpeg exists (videos are cut and joined with it).
// ffmpeg-static downloads its binary from GitHub releases at install time, and that download fails
// now and then (HTTP 502, 30 s timeouts: the first Frankfurt builds). So: several tries, then a
// fallback to the same kind of static build shipped inside an npm package (@ffmpeg-installer).
import { execFileSync, execSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("ffmpeg-static/package.json"));
const target = join(pkgDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const ok = () => existsSync(target);
const sleep = (ms) => execSync(`sleep ${ms / 1000}`);

const tries = Number(process.env.FFMPEG_TRIES ?? 2);
for (let i = 1; i <= tries && !ok(); i++) {
  try {
    execFileSync(process.execPath, [join(pkgDir, "install.js")], { stdio: "inherit", cwd: pkgDir });
  } catch {
    console.warn(`[ffmpeg] download try ${i} failed`);
    if (i < tries) sleep(5000 * i);
  }
}

if (!ok()) {
  console.warn("[ffmpeg] GitHub download failed; using the npm package @ffmpeg-installer instead");
  const plat = `${process.platform}-${process.arch}`;
  execSync(`npm install --no-save --ignore-scripts @ffmpeg-installer/${plat}`, { stdio: "inherit" });
  const src = join(dirname(require.resolve(`@ffmpeg-installer/${plat}/package.json`)), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  copyFileSync(src, target);
  chmodSync(target, 0o755);
}

// unrs-resolver (eslint) also has an install step; it is skipped by .npmrc, run it here, never fatal.
try { execFileSync(process.execPath, [require.resolve("unrs-resolver/postinstall.js")], { stdio: "inherit" }); } catch {}

if (!ok()) { console.error("[ffmpeg] no ffmpeg binary"); process.exit(1); }
console.log("[ffmpeg] ready:", execFileSync(target, ["-version"]).toString().split("\n")[0]);
