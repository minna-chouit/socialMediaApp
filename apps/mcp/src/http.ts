import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ponytail: a secret URL instead of OAuth (SRS 6.3), agreed for a single owner. Anyone with the
// URL can use the connector, so keep it private and rotate MCP_SECRET if it leaks.
const matches = (given: string, secret: string) =>
  given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));

/** The connector endpoint: /mcp/<secret> (or ?key=<secret>). Anything else is a plain 404. */
export function createHttpHandler({
  secret,
  makeServer,
}: {
  secret: string;
  makeServer: () => McpServer;
}) {
  if (secret.length < 32) throw new Error('MCP_SECRET must be at least 32 characters');
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const key = url.searchParams.get('key') ?? url.pathname.split('/').pop() ?? '';
    if (!matches(key, secret)) {
      res.writeHead(404).end();
      return;
    }
    // Stateless: a fresh server and transport per request suits serverless hosting.
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };
}
