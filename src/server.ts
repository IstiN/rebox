import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const cfg = loadConfig();
const { app } = await buildApp(cfg);

await app.listen({ port: cfg.port, host: cfg.host });
app.log.info({ port: cfg.port, host: cfg.host }, 'rebox listening');
