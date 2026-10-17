// Builds the Vercel deployment with the Build Output API (.vercel/output), so Vercel deploys exactly
// this: the connector and web app API as Node functions, the static pages, and their routes.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const out = '.vercel/output';
rmSync(out, { recursive: true, force: true });

// One Node function per entry: the connector (/api/mcp) and the owner's web app API (/api/app).
for (const [name, entry] of [
  ['mcp', 'src/vercel.ts'],
  ['app', 'src/vercel-app.ts'],
]) {
  const fn = `${out}/functions/api/${name}.func`;
  mkdirSync(fn, { recursive: true });
  await build({
    entryPoints: [entry],
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
}

cpSync('public', `${out}/static`, { recursive: true });
writeFileSync(
  `${out}/config.json`,
  JSON.stringify({
    version: 3,
    routes: [
      { src: '^/mcp/([^/]+)$', dest: '/api/mcp?key=$1' },
      // The page reads the secret from its own URL and sends it as a header.
      { src: '^/app/[^/]+$', dest: '/app.html' },
      { handle: 'filesystem' },
    ],
  }),
);
console.log(`built ${out}`);
