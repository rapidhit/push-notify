import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pnSitesTable = pgTable("pn_sites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  siteId: text("site_id").notNull().unique(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  vapidPublicKey: text("vapid_public_key").notNull(),
  vapidPrivateKey: text("vapid_private_key").notNull(),
  promptConfig: jsonb("prompt_config").$type<{
    logoUrl?: string;
    allowText?: string;
    denyText?: string;
    delaySeconds?: number;
    triggerType?: string;
    triggerValue?: number;
  }>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPnSiteSchema = createInsertSchema(pnSitesTable).omit({
  id: true,
  siteId: true,
  vapidPublicKey: true,
  vapidPrivateKey: true,
  createdAt: true,
});
export type InsertPnSite = z.infer<typeof insertPnSiteSchema>;
export type PnSite = typeof pnSitesTable.$inferSelect;
