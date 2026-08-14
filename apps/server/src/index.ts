import { loadServerConfig } from "./config.js";
import { createServer } from "./app.js";

const config = await loadServerConfig(process.argv.slice(2));
const app = await createServer(config);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void app.close().finally(() => process.exit(0)));
await app.listen({ host: config.host, port: config.port });
