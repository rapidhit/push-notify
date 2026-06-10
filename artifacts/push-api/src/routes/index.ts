import { Router } from "express";
import authRouter from "./auth";
import sitesRouter from "./sites";
import subscribersRouter from "./subscribers";
import campaignsRouter from "./campaigns";
import sdkRouter from "./sdk";
import adminRouter from "./admin";

const router = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

router.use("/auth", authRouter);
router.use("/sites", sitesRouter);
router.use(subscribersRouter);
router.use(campaignsRouter);
router.use(sdkRouter);
router.use("/admin", adminRouter);

export default router;
