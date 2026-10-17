import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHandler } from '../src/http';
import { createServer } from '../src/server';
import { freshDatabase, NOW, OWNER, pgliteDb } from './harness';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
let http: Server;
let base: string;

beforeAll(async () => {
  const db = pgliteDb(await freshDatabase());
  const makeServer = () =>
    createServer({ db, ownerId: OWNER, clock: { now: () => NOW }, signUrl: async (p) => p });
  http = createHttpServer(createHttpHandler({ secret: SECRET, makeServer }));
  await new Promise<void>((resolve) => http.listen(0, resolve));
  base = `http://localhost:${(http.address() as AddressInfo).port}`;
}, 30_000);
afterAll(() => new Promise<void>((resolve) => http.close(() => resolve())));

const initialize = (path: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      },
    }),
  });

describe('FR-28: connector endpoint', () => {
  it('FR-28: the connector URL without the right secret is a 404', async () => {
    expect((await initialize('/mcp/wrong')).status).toBe(404);
    expect((await initialize('/mcp')).status).toBe(404);
    expect((await initialize(`/mcp/${SECRET}x`)).status).toBe(404);
  });

  it('FR-28: the connector URL with the secret answers MCP initialize', async () => {
    const response = await initialize(`/mcp/${SECRET}`);
    expect(response.status).toBe(200);
    expect((await response.json()).result.serverInfo.name).toBe('cadence');
  });

  it('FR-28: a short secret is refused at startup', () => {
    expect(() => createHttpHandler({ secret: 'short', makeServer: () => null as never })).toThrow(
      /32/,
    );
  });
});
