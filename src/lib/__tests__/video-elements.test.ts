import { describe, expect, it } from "vitest";
import { elementLabel, sampleEverySecond } from "@/lib/uploads/video-elements";

describe("every-second element scan", () => {
  it("looks once each second from the start through the end", () => {
    const times = sampleEverySecond(10.04);
    expect(times).toHaveLength(10);
    expect(times[0]).toBe(0.5);
    expect(times[9]).toBe(9.5);
    expect(sampleEverySecond(30)[29]).toBe(29.5);
    expect(sampleEverySecond(0)).toEqual([0.5]);
  });

  it("names people, clothes, and other things", () => {
    expect(elementLabel("person")).toBe("Человек");
    expect(elementLabel("outfit")).toBe("Одежда");
    expect(elementLabel("cake")).toBe("Торт");
    expect(elementLabel("car")).toBe("Машина");
    expect(elementLabel("horse")).toBe("Лошадь");
    expect(elementLabel("handbag")).toBe("Сумка");
    expect(elementLabel("unknown widget")).toBe("unknown widget");
  });
});
