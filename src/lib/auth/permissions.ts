// Role-based permissions (least privilege). Pure module — safe to unit-test.
export type Role = "user" | "super_admin" | "template_manager" | "order_support";

export type Permission =
  | "admin.access"
  | "dashboard.view"
  | "templates.manage"
  | "templates.publish"
  | "pricing.manage"
  | "orders.view"
  | "orders.retry"
  | "orders.cancel"
  | "orders.refund"
  | "users.manage"
  | "audit.view";

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  user: [],
  template_manager: ["admin.access", "templates.manage", "templates.publish", "pricing.manage"],
  order_support: ["admin.access", "dashboard.view", "orders.view", "orders.retry", "orders.cancel", "orders.refund"],
  super_admin: [
    "admin.access", "dashboard.view", "templates.manage", "templates.publish", "pricing.manage",
    "orders.view", "orders.retry", "orders.cancel", "orders.refund", "users.manage", "audit.view",
  ],
};

export function can(role: Role | null | undefined, perm: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}

export function isStaff(role: Role | null | undefined): boolean {
  return can(role, "admin.access");
}
