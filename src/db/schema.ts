import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ── RBAC roles ──
// user: 普通用户（fallback）· author: 作者 · inspector: 督查
// admin: 管理员（向后兼容）· super_admin: 超级管理员（全通 + 可分配角色）
export const USER_ROLES = [
  "user",
  "author",
  "inspector",
  "admin",
  "super_admin",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const isUserRole = (v: unknown): v is UserRole =>
  typeof v === "string" && (USER_ROLES as readonly string[]).includes(v);

// ── users ── (兼容 T04，better-auth 映射到同一表)
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerified: integer("email_verified"),
  image: text("image"),
  role: text("role").notNull().default("user"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at"),
});

// better-auth 依赖表（D1 sqlite，时间戳用 integer 兼容）
export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("idx_session_user").on(t.userId),
    uniqueIndex("idx_session_token").on(t.token),
  ],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    issuer: text("issuer"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("idx_account_user").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("idx_verification_identifier").on(t.identifier)],
);

export const user = users;

// ── posts ──
export const POST_CATEGORIES = [
  "技术",
  "生活",
  "随笔",
  "教程",
  "二次元",
  "未分类",
] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];

export const isPostCategory = (v: unknown): v is PostCategory =>
  typeof v === "string" && (POST_CATEGORIES as readonly string[]).includes(v);

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    content: text("content").notNull(),
    cover: text("cover"),
    category: text("category").notNull().default("未分类"),
    status: text("status").notNull().default("published"),
    authorId: text("author_id").references(() => users.id),
    publishedAt: integer("published_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at"),
  },
  (t) => [
    index("idx_posts_slug").on(t.slug),
    index("idx_posts_published").on(t.publishedAt),
    index("idx_posts_status").on(t.status),
    index("idx_posts_category").on(t.category),
  ],
);

// ── tags ──
export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    slug: text("slug").notNull().unique(),
  },
  (t) => [
    uniqueIndex("idx_tags_name").on(t.name),
    uniqueIndex("idx_tags_slug").on(t.slug),
  ],
);

// ── post_tags (many-to-many) ──
export const postTags = sqliteTable(
  "post_tags",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.tagId] }),
    index("idx_post_tags").on(t.postId, t.tagId),
  ],
);

// ── comments ──
export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => users.id),
    parentId: text("parent_id").references((): any => comments.id),
    content: text("content").notNull(),
    status: text("status").notNull().default("approved"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_comment_post_created").on(t.postId, t.createdAt)],
);

// ── comment_reactions ──
export const commentReactions = sqliteTable(
  "comment_reactions",
  {
    id: text("id").primaryKey(),
    commentId: text("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("like"),
  },
  (t) => [uniqueIndex("idx_reaction_unique").on(t.commentId, t.userId)],
);

// ── relations ──
export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  comments: many(comments),
  commentReactions: many(commentReactions),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  postTags: many(postTags),
  comments: many(comments),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  postTags: many(postTags),
}));

export const postTagsRelations = relations(postTags, ({ one }) => ({
  post: one(posts, { fields: [postTags.postId], references: [posts.id] }),
  tag: one(tags, { fields: [postTags.tagId], references: [tags.id] }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
  parent: one(comments, {
    fields: [comments.parentId],
    references: [comments.id],
    relationName: "comment_replies",
  }),
  replies: many(comments, { relationName: "comment_replies" }),
  reactions: many(commentReactions),
}));

export const commentReactionsRelations = relations(
  commentReactions,
  ({ one }) => ({
    comment: one(comments, {
      fields: [commentReactions.commentId],
      references: [comments.id],
    }),
    user: one(users, {
      fields: [commentReactions.userId],
      references: [users.id],
    }),
  }),
);
