import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const pnSubscribersTable = pgTable("pn_subscribers", {
  id: serial("id").primaryKey(),
  siteId: text("site_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  country: text("country"),
  city: text("city"),
  region: text("region"),
  browser: text("browser"),
  os: text("os"),
  deviceType: text("device_type"),
  language: text("language"),
  screenWidth: integer("screen_width"),
  screenHeight: integer("screen_height"),
  active: boolean("active").notNull().default(true),
  subscribedAt: timestamp("subscribed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pnSubscriberTagsTable = pgTable("pn_subscriber_tags", {
  id: serial("id").primaryKey(),
  subscriberId: integer("subscriber_id").notNull(),
  siteId: text("site_id").notNull(),
  tag: text("tag").notNull(),
  taggedAt: timestamp("tagged_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PnSubscriber = typeof pnSubscribersTable.$inferSelect;
export type PnSubscriberTag = typeof pnSubscriberTagsTable.$inferSelect;
