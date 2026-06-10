import { Router } from "express";
import { db } from "@workspace/db";
import {
  pnSubscribersTable,
  pnSubscriberTagsTable,
  pnSitesTable,
  pnUsersTable,
} from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

async function getUserForSite(userId: number, siteId: string) {
  const [[user], [site]] = await Promise.all([
    db.select().from(pnUsersTable).where(eq(pnUsersTable.id, userId)),
    db.select().from(pnSitesTable).where(and(eq(pnSitesTable.siteId, siteId), eq(pnSitesTable.userId, userId))),
  ]);
  return { user: user ?? null, site: site ?? null };
}

const router = Router();

function siteAuthCheck(userId: number) {
  return async (siteId: string) => {
    const [site] = await db
      .select()
      .from(pnSitesTable)
      .where(and(eq(pnSitesTable.siteId, siteId), eq(pnSitesTable.userId, userId)));
    return site ?? null;
  };
}

router.get("/sites/:siteId/subscribers", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;
  const site = await siteAuthCheck(userId)(rawSiteId);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }

  const subscribers = await db
    .select()
    .from(pnSubscribersTable)
    .where(eq(pnSubscribersTable.siteId, rawSiteId));

  const tags = await db
    .select()
    .from(pnSubscriberTagsTable)
    .where(eq(pnSubscriberTagsTable.siteId, rawSiteId));

  const tagMap = new Map<number, string[]>();
  for (const t of tags) {
    if (!tagMap.has(t.subscriberId)) tagMap.set(t.subscriberId, []);
    tagMap.get(t.subscriberId)!.push(t.tag);
  }

  const result = subscribers.map((s) => ({
    ...s,
    p256dh: undefined,
    auth: undefined,
    tags: tagMap.get(s.id) ?? [],
  }));

  res.json(result);
});

router.delete("/sites/:siteId/subscribers/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const site = await siteAuthCheck(userId)(rawSiteId);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }

  await db.delete(pnSubscriberTagsTable).where(eq(pnSubscriberTagsTable.subscriberId, id));
  await db.delete(pnSubscribersTable).where(eq(pnSubscribersTable.id, id));
  res.sendStatus(204);
});

router.post("/sites/:siteId/subscribers/:id/tags", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const subscriberId = parseInt(rawId, 10);
  const { tag } = req.body as { tag?: string };

  const { user, site } = await getUserForSite(userId, rawSiteId);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  if (!user?.isPremium) { res.status(403).json({ error: "Subscriber tags require Premium" }); return; }
  if (!tag) { res.status(400).json({ error: "Tag is required" }); return; }

  const existing = await db
    .select()
    .from(pnSubscriberTagsTable)
    .where(
      and(
        eq(pnSubscriberTagsTable.subscriberId, subscriberId),
        eq(pnSubscriberTagsTable.tag, tag),
      ),
    );
  if (existing.length === 0) {
    await db.insert(pnSubscriberTagsTable).values({ subscriberId, siteId: rawSiteId, tag });
  }

  res.json({ success: true });
});

router.delete("/sites/:siteId/subscribers/:id/tags/:tag", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const subscriberId = parseInt(rawId, 10);
  const rawTag = Array.isArray(req.params.tag) ? req.params.tag[0] : req.params.tag;

  const { user, site } = await getUserForSite(userId, rawSiteId);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  if (!user?.isPremium) { res.status(403).json({ error: "Subscriber tags require Premium" }); return; }

  await db
    .delete(pnSubscriberTagsTable)
    .where(
      and(
        eq(pnSubscriberTagsTable.subscriberId, subscriberId),
        eq(pnSubscriberTagsTable.tag, rawTag),
      ),
    );

  res.json({ success: true });
});

router.get("/sites/:siteId/segments", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;

  const { user, site } = await getUserForSite(userId, rawSiteId);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  if (!user?.isPremium) { res.status(403).json({ error: "Segments require Premium" }); return; }

  const tags = await db
    .select({ tag: pnSubscriberTagsTable.tag, count: count() })
    .from(pnSubscriberTagsTable)
    .where(eq(pnSubscriberTagsTable.siteId, rawSiteId))
    .groupBy(pnSubscriberTagsTable.tag);

  res.json(tags);
});

router.get("/sites/:siteId/export", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;
  const filterTag = typeof req.query.tag === "string" ? req.query.tag : undefined;

  const { user, site } = await getUserForSite(userId, rawSiteId);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }
  if (!user?.isPremium) { res.status(403).json({ error: "CSV export requires Premium" }); return; }

  const subscribers = await db
    .select()
    .from(pnSubscribersTable)
    .where(eq(pnSubscribersTable.siteId, rawSiteId));

  const allTags = await db
    .select()
    .from(pnSubscriberTagsTable)
    .where(eq(pnSubscriberTagsTable.siteId, rawSiteId));

  const tagMap = new Map<number, string[]>();
  for (const t of allTags) {
    if (!tagMap.has(t.subscriberId)) tagMap.set(t.subscriberId, []);
    tagMap.get(t.subscriberId)!.push(t.tag);
  }

  let filtered = subscribers;
  if (filterTag) {
    const taggedIds = new Set(allTags.filter((t) => t.tag === filterTag).map((t) => t.subscriberId));
    filtered = subscribers.filter((s) => taggedIds.has(s.id));
  }

  const header = "subscriberId,endpoint,country,city,region,browser,os,deviceType,language,screenWidth,screenHeight,active,tags,subscribedAt\n";
  const rows = filtered.map((s) => {
    const tags = (tagMap.get(s.id) ?? []).join("|");
    return [
      s.id,
      `"${s.endpoint}"`,
      s.country ?? "",
      s.city ?? "",
      s.region ?? "",
      s.browser ?? "",
      s.os ?? "",
      s.deviceType ?? "",
      s.language ?? "",
      s.screenWidth ?? "",
      s.screenHeight ?? "",
      s.active,
      `"${tags}"`,
      s.subscribedAt.toISOString(),
    ].join(",");
  });

  const csv = header + rows.join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="subscribers-${rawSiteId}.csv"`);
  res.send(csv);
});

export default router;
