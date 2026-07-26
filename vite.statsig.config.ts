import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';
import { compiledZodSchemas } from './zod-compiler.config';

export default defineConfig({
	plugins: [compiledZodSchemas(), cloudflare({ configPath: './wrangler.statsig.jsonc' })],
});
