import { Router } from "express";
import { db } from "@workspace/db";
import { pnUsersTable, pnSitesTable, pnSubscribersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router = Router();

router.get("/stats", requireAdmin, async (_req, res): Promise<void> => {
  const [userCount] = await db.select({ count: count() }).from(pnUsersTable);
  const [siteCount] = await db.select({ count: count() }).from(pnSitesTable);
  const [subCount] = await db.select({ count: count() }).from(pnSubscribersTable);

  res.json({
    totalUsers: userCount?.count ?? 0,
    totalSites: siteCount?.count ?? 0,
    totalSubscribers: subCount?.count ?? 0,
  });
});

router.get("/users", requireAdmin, async (_req, res): Promise<void> => {
  const users = await db.select().from(pnUsersTable);

  const result = await Promise.all(
    users.map(async (user) => {
      const sites = await db.select().from(pnSitesTable).where(eq(pnSitesTable.userId, user.id));
      let totalSubscribers = 0;
      for (const site of sites) {
        const [cnt] = await db
          .select({ count: count() })
          .from(pnSubscribersTable)
          .where(eq(pnSubscribersTable.siteId, site.siteId));
        totalSubscribers += Number(cnt?.count ?? 0);
      }
      return {
        id: user.id,
        email: user.email,
        isPremium: user.isPremium,
        premiumExpiresAt: user.premiumExpiresAt,
        siteCount: sites.length,
        subscriberCount: totalSubscribers,
        createdAt: user.createdAt,
      };
    }),
  );

  res.json(result);
});

router.post("/users/:id/grant-premium", requireAdmin, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await db
    .update(pnUsersTable)
    .set({ isPremium: true, premiumExpiresAt: expiresAt })
    .where(eq(pnUsersTable.id, id));

  res.json({ success: true, premiumExpiresAt: expiresAt });
});

router.post("/users/:id/revoke-premium", requireAdmin, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  await db
    .update(pnUsersTable)
    .set({ isPremium: false, premiumExpiresAt: null })
    .where(eq(pnUsersTable.id, id));

  res.json({ success: true });
});

export default router;
