import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isIP } from 'node:net';

mkdirSync(dirname(process.env.DATABASE_PATH || '/app/storage/uzex.sqlite'), { recursive: true });
let host = process.env.SERVER_IP;
if (!host && !process.env.PUBLIC_URL) {
  try {
    const response = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(3000) });
    const candidate = (await response.text()).trim();
    if (response.ok && isIP(candidate)) host = candidate;
  } catch { /* An offline server can set SERVER_IP explicitly. */ }
}
const address = host ? (isIP(host) === 6 ? `[${host}]` : host) : '<server-ip>';
const url = process.env.PUBLIC_URL || `http://${address}:${process.env.APP_PORT || 3000}/`;
console.log(`\nUZEX Assist URL: ${url}\nPath: /\nHealth: /healthz\n`);
await import('../server.mjs');
