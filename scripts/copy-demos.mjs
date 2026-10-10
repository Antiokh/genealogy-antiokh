import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist/demos', { recursive: true });
await cp('demos', 'dist/demos', { recursive: true, force: true });

console.log('Copied existing demos to dist/demos');
