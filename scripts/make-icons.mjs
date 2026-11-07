// Builds the app icons from the logo mark: white mark on a black tile (inner triangle black).
// Run: node scripts/make-icons.mjs  → src/app/icon.png (512, rounded), apple-icon.png (180, full bleed),
// favicon.ico (16/32/48, rounded).
import sharp from "sharp";
import { writeFile } from "node:fs/promises";

const INK = "#0e0e0e", MARK = "#ffffff";
const mark = `
  <g stroke="${MARK}" stroke-linecap="round" fill="none">
    <path d="M10 26h9M6 32h13M9 38h10M13 44h7" stroke-width="3.2"/>
    <circle cx="5" cy="26" r="1.7" fill="${MARK}" stroke="none"/>
  </g>
  <path d="M25.5 14.6c0-3.3 3.6-5.4 6.5-3.7l22.3 13.4c3 1.8 3 6.1 0 7.9L32 45.6c-2.9 1.7-6.5-.4-6.5-3.7z" transform="translate(-4 4)" fill="${MARK}" stroke="${MARK}" stroke-width="3.6" stroke-linejoin="round"/>
  <path d="M31.5 28.3c0-1.3 1.4-2.1 2.6-1.4l7.4 4.4c1.1.7 1.1 2.3 0 3l-7.4 4.4c-1.2.7-2.6-.1-2.6-1.4z" fill="${INK}"/>
  <g fill="${MARK}">
    <path d="M51 6.5c.4 2.6 1.6 3.8 4.2 4.2-2.6.4-3.8 1.6-4.2 4.2-.4-2.6-1.6-3.8-4.2-4.2 2.6-.4 3.8-1.6 4.2-4.2z"/>
    <path d="M58 13.5c.25 1.6 1 2.35 2.6 2.6-1.6.25-2.35 1-2.6 2.6-.25-1.6-1-2.35-2.6-2.6 1.6-.25 2.35-1 2.6-2.6z"/>
    <path d="M44.5 3c.2 1.2.8 1.8 2 2-1.2.2-1.8.8-2 2-.2-1.2-.8-1.8-2-2 1.2-.2 1.8-.8 2-2z"/>
  </g>`;

// The mark's box is x 2..62, y -1..55 (60×56); it fills `scale` of the tile, centred.
function svg(size, { rounded, scale }) {
  const w = size * scale, k = w / 60, h = 56 * k;
  const tx = (size - w) / 2 - 2 * k, ty = (size - h) / 2 + 1 * k;
  const r = rounded ? size * 0.225 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${r}" fill="${INK}"/>
    <g transform="translate(${tx} ${ty}) scale(${k})">${mark}</g></svg>`;
}
const png = (size, o) => sharp(Buffer.from(svg(size, o))).png().toBuffer();

await writeFile("src/app/icon.png", await png(512, { rounded: true, scale: 0.66 }));
await writeFile("src/app/apple-icon.png", await png(180, { rounded: false, scale: 0.62 }));

// favicon.ico: PNG-in-ICO with 16, 32 and 48 px images (small sizes get a bigger mark).
const sizes = [16, 32, 48];
const imgs = await Promise.all(sizes.map((s) => png(s, { rounded: true, scale: s <= 16 ? 0.8 : 0.74 })));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += imgs[i].length;
});
await writeFile("src/app/favicon.ico", Buffer.concat([head, ...imgs]));
console.log("icons written");
