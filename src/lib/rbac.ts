import { isUserRole, type UserRole } from "../db/schema";

export type { UserRole };

export const ROLE_LABELS: Record<UserRole, string> = {
  user: "普通用户",
  author: "作者",
  inspector: "督查",
  admin: "管理员",
  super_admin: "超级管理员",
};

export const ASSIGNABLE_ROLES: UserRole[] = [
  "user",
  "author",
  "inspector",
  "admin",
  "super_admin",
];

export const normalizeRole = (v: unknown): UserRole =>
  isUserRole(v) ? v : "user";

const BACKEND_ROLES: Record<string, UserRole[]> = {
  "/admin": ["admin", "super_admin"],
  "/author": ["author", "admin", "super_admin"],
  "/inspector": ["inspector", "admin", "super_admin"],
  "/super": ["super_admin"],
};

export function allowedRoles(pathname: string): UserRole[] | null {
  for (const prefix of Object.keys(BACKEND_ROLES)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return BACKEND_ROLES[prefix];
    }
  }
  return null;
}

export function canAccess(role: unknown, pathname: string): boolean {
  const allowed = allowedRoles(pathname);
  if (!allowed) return true;
  const r = normalizeRole(role);
  if (r === "super_admin") return true;
  return allowed.includes(r);
}

export function homeFor(role: unknown): string {
  switch (normalizeRole(role)) {
    case "super_admin":
      return "/super";
    case "admin":
      return "/admin";
    case "author":
      return "/author";
    case "inspector":
      return "/inspector";
    default:
      return "/";
  }
}
