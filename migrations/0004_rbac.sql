-- 0004_rbac: expand users.role to 4 backends + super_admin
-- SQLite/D1 has no ALTER CHECK; roles are enforced at app layer (src/lib/rbac.ts).
-- This migration normalizes legacy values and guarantees a super_admin exists.

-- Backfill NULL/empty roles to fallback 'user'
UPDATE users SET role = 'user' WHERE role IS NULL OR role = '';

-- Normalize any unexpected legacy values to 'user' (keeps admin/user intact)
UPDATE users SET role = 'user'
WHERE role NOT IN ('user', 'author', 'inspector', 'admin', 'super_admin');

-- Promote existing admins to super_admin so the site keeps an owner.
-- Keeps backward compat: 'admin' role still valid; super_admin is a superset.
UPDATE users SET role = 'super_admin' WHERE email = 'admin@mizuki.blog';
UPDATE users SET role = 'super_admin' WHERE id IN ('user_admin', 'user_admin_01');

-- If no super_admin exists yet (fresh DB), create one.
-- Password must be set via register/reset flow; this row only reserves identity.
INSERT INTO users (id, email, name, role, created_at)
SELECT 'user_super_admin', 'superadmin@mizuki.blog', 'Super Admin', 'super_admin', unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'super_admin');

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
