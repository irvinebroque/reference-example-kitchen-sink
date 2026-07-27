import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';
import { compiledZodSchemas } from './zod-compiler.config';

export default defineConfig({
	optimizeDeps: {
		include: [
			'@cloudflare/kumo/components/badge',
			'@cloudflare/kumo/components/button',
			'@cloudflare/kumo/components/cloudflare-logo',
			'@cloudflare/kumo/components/input',
			'@cloudflare/kumo/components/layer-card',
			'@cloudflare/kumo/components/link',
			'@cloudflare/kumo/components/text',
		],
	},
	ssr: {
		noExternal: [/^next-auth(?:\/|$)/],
	},
	plugins: [
		compiledZodSchemas(),
		cloudflare({
			viteEnvironment: { name: 'ssr' },
			auxiliaryWorkers: [{ configPath: './wrangler.statsig.jsonc' }],
		}),
		reactRouter(),
	],
});
