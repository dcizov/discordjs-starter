import "dotenv/config";
import { startBot } from "./bootstrap";
import { logger } from "@orbit/core/logger";
import { errorDiagnostic } from "@orbit/core/diagnostics";

void startBot().catch((error: unknown) => {
  logger.fatal({ error: errorDiagnostic(error) }, "Bot failed");
  process.exitCode = 1;
});
