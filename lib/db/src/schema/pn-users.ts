import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pnUsersTable = pgTable("pn_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  isPremium: boolean("is_premium").notNull().default(false),
  premiumExpiresAt: timestamp("premium_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPnUserSchema = createInsertSchema(pnUsersTable).omit({
  id: true,
  createdAt: true,
  isPremium: true,
  premiumExpiresAt: true,
});
export type InsertPnUser = z.infer<typeof insertPnUserSchema>;
export type PnUser = typeof pnUsersTable.$inferSelect;
