import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

export const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    console.error(
      "❌ Invalid environment variables:\n" + z.prettifyError(parsed.error)
    );
    process.exit(1);
  }

  return parsed.data;
}
