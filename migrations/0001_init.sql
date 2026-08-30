PRAGMA foreign_keys=ON;

-- users (compatible with better-auth user table)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  email_verified INTEGER,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  author_id TEXT REFERENCES users(id),
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_slug ON tags(slug);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_post_tags ON post_tags(post_id, tag_id);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id),
  parent_id TEXT REFERENCES comments(id),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comment_post_created ON comments(post_id, created_at);

CREATE TABLE IF NOT EXISTS comment_reactions (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'like',
  UNIQUE(comment_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reaction_unique ON comment_reactions(comment_id, user_id);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_token ON session(token);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  password TEXT,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  scope TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_user ON account(user_id);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);

-- FTS5 virtual table for search
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(title, excerpt, content, slug UNINDEXED, tokenize='porter unicode61');
CREATE TRIGGER IF NOT EXISTS posts_fts_insert AFTER INSERT ON posts BEGIN INSERT INTO posts_fts(rowid, title, excerpt, content, slug) VALUES (new.rowid, new.title, new.excerpt, new.content, new.slug); END;
CREATE TRIGGER IF NOT EXISTS posts_fts_delete AFTER DELETE ON posts BEGIN INSERT INTO posts_fts(posts_fts, rowid, title, excerpt, content, slug) VALUES('delete', old.rowid, old.title, old.excerpt, old.content, old.slug); END;
CREATE TRIGGER IF NOT EXISTS posts_fts_update AFTER UPDATE ON posts BEGIN INSERT INTO posts_fts(posts_fts, rowid, title, excerpt, content, slug) VALUES('delete', old.rowid, old.title, old.excerpt, old.content, old.slug); INSERT INTO posts_fts(rowid, title, excerpt, content, slug) VALUES (new.rowid, new.title, new.excerpt, new.content, new.slug); END;

-- seed data (minimal)
INSERT OR IGNORE INTO users (id, email, name, email_verified, created_at) VALUES ('user_admin', 'admin@mizuki.blog', 'Mizuki Admin', 1, strftime('%s','now')*1000);
INSERT OR IGNORE INTO posts (id, slug, title, excerpt, content, status, author_id, published_at, created_at) VALUES
  ('post_1', 'hello-mizuki', 'Hello Mizuki 🌊', '欢迎来到 Mizuki 风格的动态博客', '# Hello Mizuki\n\n欢迎来到水月风格博客！', 'published', 'user_admin', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('post_2', 'deep-sea-notes', '深海笔记', '深海渐变与 oklch', '# 深海笔记\n\nMizuki 色彩基于 oklch hue=240', 'published', 'user_admin', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('post_3', 'astro-on-workers', 'Astro on Workers', '在 Workers 上跑 Astro SSR', '# Astro on Workers\n\nCloudflare Workers + D1 + KV', 'published', 'user_admin', strftime('%s','now')*1000, strftime('%s','now')*1000);
INSERT OR IGNORE INTO tags (id, name, slug) VALUES ('tag_astro', 'astro', 'astro'), ('tag_mizuki', 'mizuki', 'mizuki');
INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES ('post_1', 'tag_mizuki'), ('post_3', 'tag_astro');
INSERT OR IGNORE INTO comments (id, post_id, author_id, content, status, created_at) VALUES ('c1', 'post_1', 'user_admin', '第一条评论！', 'approved', strftime('%s','now')*1000);
