ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
-- ensure existing seed admin gets admin role
UPDATE users SET role='admin' WHERE email='admin@mizuki.blog';
UPDATE users SET role='admin' WHERE id IN ('user_admin', 'user_admin_01');
