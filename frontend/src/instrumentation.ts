export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installLogCapture } = await import("./lib/server/log-capture");
    installLogCapture();
  }
}
