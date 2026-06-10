import { Router } from "express";
import bcrypt from "bcrypt";
import { db } from "@workspace/db";
import { pnUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken, requireAuth } from "../lib/auth";

const router = Router();

router.post("/register", async (req, res): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  const existing = await db.select().from(pnUsersTable).where(eq(pnUsersTable.email, email.toLowerCase()));
  if (existing.length > 0) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }

  const hashed = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(pnUsersTable)
    .values({ email: email.toLowerCase(), password: hashed })
    .returning();

  const token = signToken(user.id);
  res.status(201).json({
    token,
    user: {
      id: user.id,
      email: user.email,
      isPremium: user.isPremium,
      premiumExpiresAt: user.premiumExpiresAt,
      createdAt: user.createdAt,
    },
  });
});

router.post("/login", async (req, res): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const [user] = await db.select().from(pnUsersTable).where(eq(pnUsersTable.email, email.toLowerCase()));
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const now = new Date();
  if (user.isPremium && user.premiumExpiresAt && user.premiumExpiresAt < now) {
    await db.update(pnUsersTable).set({ isPremium: false, premiumExpiresAt: null }).where(eq(pnUsersTable.id, user.id));
    user.isPremium = false;
    user.premiumExpiresAt = null;
  }

  const token = signToken(user.id);
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      isPremium: user.isPremium,
      premiumExpiresAt: user.premiumExpiresAt,
      createdAt: user.createdAt,
    },
  });
});

router.get("/me", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const [user] = await db.select().from(pnUsersTable).where(eq(pnUsersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const now = new Date();
  if (user.isPremium && user.premiumExpiresAt && user.premiumExpiresAt < now) {
    await db.update(pnUsersTable).set({ isPremium: false, premiumExpiresAt: null }).where(eq(pnUsersTable.id, user.id));
    user.isPremium = false;
    user.premiumExpiresAt = null;
  }

  res.json({
    id: user.id,
    email: user.email,
    isPremium: user.isPremium,
    premiumExpiresAt: user.premiumExpiresAt,
    createdAt: user.createdAt,
  });
});

router.post("/activate-premium", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as typeof req & { userId: number }).userId;
  const { code } = req.body as { code?: string };

  const PREMIUM_SECRET_CODE = process.env.PREMIUM_SECRET_CODE ?? "3334434";
  if (!code || code !== PREMIUM_SECRET_CODE) {
    res.status(400).json({ error: "Invalid activation code" });
    return;
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await db
    .update(pnUsersTable)
    .set({ isPremium: true, premiumExpiresAt: expiresAt })
    .where(eq(pnUsersTable.id, userId));

  res.json({ success: true, premiumExpiresAt: expiresAt });
});

export default router;
