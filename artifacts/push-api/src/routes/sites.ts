import { Router } from "express";
import webpush from "web-push";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { pnSitesTable, pnUsersTable, pnSubscribersTable, pnCampaignsTable, pnCampaignStatsTable } from "@workspace/db";
import { eq, and, count, gte, desc, isNotNull, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();

router.get("/", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const sites = await db
    .select()
    .from(pnSitesTable)
    .where(eq(pnSitesTable.userId, userId));

  const result = await Promise.all(
    sites.map(async (site) => {
      const [countResult] = await db
        .select({ count: count() })
        .from(pnSubscribersTable)
        .where(eq(pnSubscribersTable.siteId, site.siteId));
      return {
        ...site,
        vapidPrivateKey: undefined,
        subscriberCount: countResult?.count ?? 0,
      };
    }),
  );

  res.json(result);
});

router.post("/", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const { name, domain, promptConfig } = req.body as { name?: string; domain?: string; promptConfig?: Record<string, unknown> };

  if (!name || !domain) {
    res.status(400).json({ error: "Name and domain are required" });
    return;
  }

  const [user] = await db.select().from(pnUsersTable).where(eq(pnUsersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const existingSites = await db.select().from(pnSitesTable).where(eq(pnSitesTable.userId, userId));
  if (!user.isPremium && existingSites.length >= 1) {
    res.status(403).json({ error: "Free tier is limited to 1 site. Upgrade to Premium for more." });
    return;
  }

  const vapidKeys = webpush.generateVAPIDKeys();
  const siteId = randomBytes(8).toString("hex");

  const [site] = await db
    .insert(pnSitesTable)
    .values({
      userId,
      siteId,
      name,
      domain: domain.replace(/\/$/, ""),
      vapidPublicKey: vapidKeys.publicKey,
      vapidPrivateKey: vapidKeys.privateKey,
      promptConfig: promptConfig ?? { promptStyle: "native" },
    })
    .returning();

  res.status(201).json({ ...site, vapidPrivateKey: undefined });
});

router.get("/:siteId", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;

  const [site] = await db
    .select()
    .from(pnSitesTable)
    .where(and(eq(pnSitesTable.siteId, rawSiteId), eq(pnSitesTable.userId, userId)));

  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  const [countResult] = await db
    .select({ count: count() })
    .from(pnSubscribersTable)
    .where(eq(pnSubscribersTable.siteId, rawSiteId));

  res.json({ ...site, vapidPrivateKey: undefined, subscriberCount: countResult?.count ?? 0 });
});

router.patch("/:siteId", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;

  const [site] = await db
    .select()
    .from(pnSitesTable)
    .where(and(eq(pnSitesTable.siteId, rawSiteId), eq(pnSitesTable.userId, userId)));

  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  const { name, domain, promptConfig } = req.body as {
    name?: string;
    domain?: string;
    promptConfig?: Record<string, unknown>;
  };

  const updates: Partial<typeof pnSitesTable.$inferSelect> = {};
  if (name) updates.name = name;
  if (domain) updates.domain = domain.replace(/\/$/, "");
  if (promptConfig !== undefined) updates.promptConfig = promptConfig as typeof site.promptConfig;

  const [updated] = await db
    .update(pnSitesTable)
    .set(updates)
    .where(eq(pnSitesTable.siteId, rawSiteId))
    .returning();

  res.json({ ...updated, vapidPrivateKey: undefined });
});

router.delete("/:siteId", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;

  const [site] = await db
    .select()
    .from(pnSitesTable)
    .where(and(eq(pnSitesTable.siteId, rawSiteId), eq(pnSitesTable.userId, userId)));

  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }

  await db.delete(pnSitesTable).where(eq(pnSitesTable.siteId, rawSiteId));
  res.sendStatus(204);
});

router.get("/:siteId/analytics", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;

  const [site] = await db.select().from(pnSitesTable).where(and(eq(pnSitesTable.siteId, rawSiteId), eq(pnSitesTable.userId, userId)));
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }

  const [user] = await db.select().from(pnUsersTable).where(eq(pnUsersTable.id, userId));
  if (!user?.isPremium) { res.status(403).json({ error: "Analytics requires Premium" }); return; }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [subscriberGrowth, topCountries, deviceBreakdown, browserBreakdown, activeResult, inactiveResult, sentCampaigns] = await Promise.all([
    db.select({
      date: sql<string>`(date_trunc('day', ${pnSubscribersTable.subscribedAt}))::date::text`,
      count: count(),
    })
    .from(pnSubscribersTable)
    .where(and(eq(pnSubscribersTable.siteId, rawSiteId), gte(pnSubscribersTable.subscribedAt, thirtyDaysAgo)))
    .groupBy(sql`date_trunc('day', ${pnSubscribersTable.subscribedAt})`)
    .orderBy(sql`date_trunc('day', ${pnSubscribersTable.subscribedAt})`),

    db.select({ country: pnSubscribersTable.country, count: count() })
    .from(pnSubscribersTable)
    .where(and(eq(pnSubscribersTable.siteId, rawSiteId), isNotNull(pnSubscribersTable.country)))
    .groupBy(pnSubscribersTable.country)
    .orderBy(desc(count()))
    .limit(10),

    db.select({ deviceType: pnSubscribersTable.deviceType, count: count() })
    .from(pnSubscribersTable)
    .where(and(eq(pnSubscribersTable.siteId, rawSiteId), isNotNull(pnSubscribersTable.deviceType)))
    .groupBy(pnSubscribersTable.deviceType)
    .orderBy(desc(count())),

    db.select({ browser: pnSubscribersTable.browser, count: count() })
    .from(pnSubscribersTable)
    .where(and(eq(pnSubscribersTable.siteId, rawSiteId), isNotNull(pnSubscribersTable.browser)))
    .groupBy(pnSubscribersTable.browser)
    .orderBy(desc(count())),

    db.select({ count: count() }).from(pnSubscribersTable)
    .where(and(eq(pnSubscribersTable.siteId, rawSiteId), eq(pnSubscribersTable.active, true))),

    db.select({ count: count() }).from(pnSubscribersTable)
    .where(and(eq(pnSubscribersTable.siteId, rawSiteId), eq(pnSubscribersTable.active, false))),

    db.select().from(pnCampaignsTable)
    .where(and(eq(pnCampaignsTable.siteId, rawSiteId), eq(pnCampaignsTable.status, "sent"))),
  ]);

  let bestCampaigns: Array<{ id: number; title: string; sent: number; clicked: number; ctr: number }> = [];
  if (sentCampaigns.length > 0) {
    const statsRows = await db.select().from(pnCampaignStatsTable)
      .where(inArray(pnCampaignStatsTable.campaignId, sentCampaigns.map((c) => c.id)));
    const statsMap = new Map(statsRows.map((s) => [s.campaignId, s]));
    bestCampaigns = sentCampaigns.map((c) => {
      const stats = statsMap.get(c.id);
      const s = stats?.sent ?? 0;
      const cl = stats?.clicked ?? 0;
      return { id: c.id, title: c.title, sent: s, clicked: cl, ctr: s > 0 ? Math.round((cl / s) * 1000) / 10 : 0 };
    }).sort((a, b) => b.ctr - a.ctr).slice(0, 5);
  }

  res.json({
    subscriberGrowth: subscriberGrowth.map((r) => ({ date: r.date, count: r.count })),
    topCountries: topCountries.map((r) => ({ country: r.country ?? "Unknown", count: r.count })),
    deviceBreakdown: deviceBreakdown.map((r) => ({ deviceType: r.deviceType ?? "Unknown", count: r.count })),
    browserBreakdown: browserBreakdown.map((r) => ({ browser: r.browser ?? "Unknown", count: r.count })),
    activeCount: activeResult[0]?.count ?? 0,
    inactiveCount: inactiveResult[0]?.count ?? 0,
    bestCampaigns,
  });
});

export default router;
