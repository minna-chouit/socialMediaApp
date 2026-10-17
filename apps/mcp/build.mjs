// Builds the Vercel deployment with the Build Output API (.vercel/output), so Vercel deploys exactly
// this: one Node function for the connector, the static index page, and the /mcp/<key> route.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const out = '.vercel/output';
const fn = `${out}/functions/api/mcp.func`;
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: ['src/vercel.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: `${fn}/index.mjs`,
  // Some bundled dependencies still call require(); give ESM output a real one.
  banner: {
    js: "import{createRequire}from'node:module';const require=createRequire(import.meta.url);",
  },
});

writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({
    runtime: 'nodejs22.x',
    handler: 'index.mjs',
    launcherType: 'Nodejs',
    maxDuration: 30,
  }),
);
cpSync('public', `${out}/static`, { recursive: true });
writeFileSync(
  `${out}/config.json`,
  JSON.stringify({
    version: 3,
    routes: [{ src: '^/mcp/([^/]+)$', dest: '/api/mcp?key=$1' }, { handle: 'filesystem' }],
  }),
);
console.log(`built ${out}`);
