export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvironment } = await import("@orbit/core/environment");
    validateEnvironment("web");
  }
}
