import { describe, it, expect } from "vitest";
import { can, isStaff } from "../auth/permissions";
import { safeNext } from "../auth/redirect";

describe("permissions", () => {
  it("regular users have no admin access", () => {
    expect(isStaff("user")).toBe(false);
    expect(can("user", "orders.view")).toBe(false);
    expect(can(null, "admin.access")).toBe(false);
  });
  it("template managers cannot refund or manage users", () => {
    expect(can("template_manager", "templates.publish")).toBe(true);
    expect(can("template_manager", "orders.refund")).toBe(false);
    expect(can("template_manager", "users.manage")).toBe(false);
  });
  it("order support cannot edit templates or pricing", () => {
    expect(can("order_support", "orders.refund")).toBe(true);
    expect(can("order_support", "templates.manage")).toBe(false);
    expect(can("order_support", "pricing.manage")).toBe(false);
  });
  it("super admin has everything", () => {
    expect(can("super_admin", "users.manage")).toBe(true);
    expect(can("super_admin", "audit.view")).toBe(true);
  });
});

describe("safeNext", () => {
  it("allows relative paths", () => expect(safeNext("/orders/1")).toBe("/orders/1"));
  it("blocks open redirects", () => {
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
