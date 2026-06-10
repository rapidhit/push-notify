import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";

const rawPort = process.env["PORT"];
const port = rawPort ? Number(rawPort) : 8099;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, () => {
  logger.info({ port }, "Push API server listening");
  startScheduler();
});
