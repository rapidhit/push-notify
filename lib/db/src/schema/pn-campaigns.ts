import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const pnCampaignsTable = pgTable("pn_campaigns", {
  id: serial("id").primaryKey(),
  siteId: text("site_id").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  iconUrl: text("icon_url"),
  imageUrl: text("image_url"),
  destinationUrl: text("destination_url").notNull(),
  label: text("label"),
  status: text("status").notNull().default("draft"),
  targetingFilters: jsonb("targeting_filters").$type<{
    countries?: string[];
    cities?: string[];
    deviceTypes?: string[];
    browsers?: string[];
    os?: string[];
    languages?: string[];
    hasTag?: string;
    notHasTag?: string;
    csvSubscriberIds?: number[];
  }>().default({}),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pnCampaignStatsTable = pgTable("pn_campaign_stats", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  sent: integer("sent").notNull().default(0),
  delivered: integer("delivered").notNull().default(0),
  clicked: integer("clicked").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pnClickEventsTable = pgTable("pn_click_events", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  subscriberId: integer("subscriber_id").notNull(),
  clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PnCampaign = typeof pnCampaignsTable.$inferSelect;
export type PnCampaignStats = typeof pnCampaignStatsTable.$inferSelect;
export type PnClickEvent = typeof pnClickEventsTable.$inferSelect;
