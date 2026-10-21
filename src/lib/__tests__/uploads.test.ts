import { describe, it, expect } from "vitest";
import { validatePhotoMeta, sniffImageType } from "../uploads/validate";

const limits = { maxBytes: 10 * 1024 * 1024, minDimension: 256, maxDimension: 8192 };

describe("validatePhotoMeta", () => {
  it("accepts a normal photo", () => {
    expect(validatePhotoMeta({ contentType: "image/jpeg", size: 2e6, width: 1080, height: 1350 }, limits)).toBeNull();
  });
  it("rejects wrong types, oversize, tiny and unreadable images", () => {
    expect(validatePhotoMeta({ contentType: "image/gif", size: 1e5, width: 500, height: 500 }, limits)).toBe("bad_type");
    expect(validatePhotoMeta({ contentType: "image/png", size: 11e6, width: 500, height: 500 }, limits)).toBe("too_large");
    expect(validatePhotoMeta({ contentType: "image/png", size: 1e5, width: 200, height: 900 }, limits)).toBe("too_small");
    expect(validatePhotoMeta({ contentType: "image/png", size: 1e5, width: 9000, height: 900 }, limits)).toBe("too_big_dimensions");
    expect(validatePhotoMeta({ contentType: "image/webp", size: 1e5 }, limits)).toBe("unreadable");
  });
});

describe("sniffImageType", () => {
  it("detects by magic bytes", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
  });
  it("rejects disguised files", () => {
    expect(sniffImageType(new TextEncoder().encode("<html>not an image"))).toBeNull();
  });
});
