import { Router } from "express";
import { db } from "@workspace/db";
import {
  pnCampaignsTable,
  pnCampaignStatsTable,
  pnClickEventsTable,
  pnSitesTable,
  pnSubscriberTagsTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { pnSubscribersTable, pnUsersTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { sendCampaign } from "../lib/push-sender";

const router = Router();

async function getSiteForUser(siteId: string, userId: number) {
  const [site] = await db
    .select()
    .from(pnSitesTable)
    .where(and(eq(pnSitesTable.siteId, siteId), eq(pnSitesTable.userId, userId)));
  return site ?? null;
}

router.get("/sites/:siteId/campaigns", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;
  const site = await getSiteForUser(rawSiteId, userId);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }

  const campaigns = await db
    .select()
    .from(pnCampaignsTable)
    .where(eq(pnCampaignsTable.siteId, rawSiteId));

  const statsMap = new Map<number, typeof pnCampaignStatsTable.$inferSelect>();
  const allStats = await db
    .select()
    .from(pnCampaignStatsTable)
    .where(
      campaigns.length > 0
        ? (campaigns.length === 1
            ? eq(pnCampaignStatsTable.campaignId, campaigns[0].id)
            : undefined)
        : undefined,
    );

  for (const s of allStats) statsMap.set(s.campaignId, s);

  res.json(campaigns.map((c) => ({ ...c, stats: statsMap.get(c.id) ?? null })));
});

router.post("/sites/:siteId/campaigns", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;
  const site = await getSiteForUser(rawSiteId, userId);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }

  const {
    title, message, iconUrl, imageUrl, destinationUrl,
    label, targetingFilters, scheduledAt, sendNow,
    csvSubscriberIds,
  } = req.body as {
    title?: string;
    message?: string;
    iconUrl?: string;
    imageUrl?: string;
    destinationUrl?: string;
    label?: string;
    targetingFilters?: Record<string, string>;
    scheduledAt?: string;
    sendNow?: boolean;
    csvSubscriberIds?: number[];
  };

  if (!title || !message || !destinationUrl) {
    res.status(400).json({ error: "Title, message, and destination URL are required" });
    return;
  }

  const [user] = await db.select().from(pnUsersTable).where(eq(pnUsersTable.id, userId));

  const hasTargeting = targetingFilters && Object.values(targetingFilters).some((v) => v && String(v).trim());
  const hasCsv = csvSubscriberIds && csvSubscriberIds.length > 0;

  if (!user?.isPremium) {
    if (scheduledAt && !sendNow) {
      res.status(403).json({ error: "Campaign scheduling requires Premium" });
      return;
    }
    if (hasTargeting || hasCsv) {
      res.status(403).json({ error: "Audience targeting requires Premium" });
      return;
    }
  }

  const splitToArray = (val?: string) =>
    val ? val.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  const filters: Record<string, unknown> = {};
  if (targetingFilters) {
    const c = splitToArray(targetingFilters.country);
    if (c?.length) filters.countries = c;
    const br = splitToArray(targetingFilters.browser);
    if (br?.length) filters.browsers = br;
    const os = splitToArray(targetingFilters.os);
    if (os?.length) filters.os = os;
    const dt = splitToArray(targetingFilters.deviceType);
    if (dt?.length) filters.deviceTypes = dt;
    const lang = splitToArray(targetingFilters.language);
    if (lang?.length) filters.languages = lang;
    if (targetingFilters.has_tag) filters.hasTag = targetingFilters.has_tag;
    if (targetingFilters.not_tag) filters.notHasTag = targetingFilters.not_tag;
  }
  if (hasCsv) filters.csvSubscriberIds = csvSubscriberIds;

  const status = scheduledAt && !sendNow ? "scheduled" : "draft";

  const [campaign] = await db
    .insert(pnCampaignsTable)
    .values({
      siteId: rawSiteId,
      title,
      message,
      iconUrl: iconUrl ?? null,
      imageUrl: imageUrl ?? null,
      destinationUrl,
      label: label ?? null,
      status,
      targetingFilters: filters as typeof pnCampaignsTable.$inferSelect["targetingFilters"],
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    })
    .returning();

  if (sendNow) {
    sendCampaign(campaign, site).catch(() => {});
  }

  res.status(201).json(campaign);
});

router.get("/sites/:siteId/campaigns/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const site = await getSiteForUser(rawSiteId, userId);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }

  const [campaign] = await db
    .select()
    .from(pnCampaignsTable)
    .where(and(eq(pnCampaignsTable.id, id), eq(pnCampaignsTable.siteId, rawSiteId)));

  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  const [stats] = await db
    .select()
    .from(pnCampaignStatsTable)
    .where(eq(pnCampaignStatsTable.campaignId, id));

  const clicks = await db
    .select()
    .from(pnClickEventsTable)
    .where(eq(pnClickEventsTable.campaignId, id));

  res.json({ ...campaign, stats: stats ?? null, clicks });
});

router.post("/sites/:siteId/campaigns/:id/send", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const site = await getSiteForUser(rawSiteId, userId);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }

  const [campaign] = await db
    .select()
    .from(pnCampaignsTable)
    .where(and(eq(pnCampaignsTable.id, id), eq(pnCampaignsTable.siteId, rawSiteId)));

  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  if (campaign.status === "sending") {
    res.status(400).json({ error: "Campaign is currently sending, please wait" });
    return;
  }

  sendCampaign(campaign, site).catch(() => {});
  res.json({ success: true, message: "Campaign send started" });
});

router.delete("/sites/:siteId/campaigns/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const site = await getSiteForUser(rawSiteId, userId);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }

  await db.delete(pnCampaignStatsTable).where(eq(pnCampaignStatsTable.campaignId, id));
  await db.delete(pnClickEventsTable).where(eq(pnClickEventsTable.campaignId, id));
  await db.delete(pnCampaignsTable).where(eq(pnCampaignsTable.id, id));
  res.sendStatus(204);
});

router.get("/sites/:siteId/campaigns/:id/insights", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const rawSiteId = Array.isArray(req.params.siteId) ? req.params.siteId[0] : req.params.siteId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const site = await getSiteForUser(rawSiteId, userId);
  if (!site) { res.status(404).json({ error: "Site not found" }); return; }

  const [campaign] = await db.select().from(pnCampaignsTable)
    .where(and(eq(pnCampaignsTable.id, id), eq(pnCampaignsTable.siteId, rawSiteId)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

  const [stats] = await db.select().from(pnCampaignStatsTable).where(eq(pnCampaignStatsTable.campaignId, id));
  const clicks = await db.select().from(pnClickEventsTable).where(eq(pnClickEventsTable.campaignId, id));

  const timelineMap = new Map<string, number>();
  for (const click of clicks) {
    const date = click.clickedAt.toISOString().split("T")[0];
    timelineMap.set(date, (timelineMap.get(date) ?? 0) + 1);
  }
  const clickTimeline = Array.from(timelineMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const subscriberIds = [...new Set(clicks.map((c) => c.subscriberId).filter((sid) => sid > 0))];
  let deviceBreakdown: { name: string; count: number }[] = [];
  let countryBreakdown: { name: string; count: number }[] = [];
  let browserBreakdown: { name: string; count: number }[] = [];

  if (subscriberIds.length > 0) {
    const subs = await db.select().from(pnSubscribersTable).where(inArray(pnSubscribersTable.id, subscriberIds));
    const devMap = new Map<string, number>();
    const cntMap = new Map<string, number>();
    const brMap = new Map<string, number>();
    for (const s of subs) {
      const d = s.deviceType ?? "Unknown";
      const c = s.country ?? "Unknown";
      const b = s.browser ?? "Unknown";
      devMap.set(d, (devMap.get(d) ?? 0) + 1);
      cntMap.set(c, (cntMap.get(c) ?? 0) + 1);
      brMap.set(b, (brMap.get(b) ?? 0) + 1);
    }
    deviceBreakdown = [...devMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    countryBreakdown = [...cntMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    browserBreakdown = [...brMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }

  res.json({
    stats: stats ?? null,
    clickTimeline,
    deviceBreakdown,
    countryBreakdown,
    browserBreakdown,
  });
});

export default router;
