import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';
import { compiledZodSchemas } from './zod-compiler.config';

export default defineConfig(({ command }) => ({
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
			auxiliaryWorkers: [
				{
					configPath: './wrangler.statsig.jsonc',
					config:
						command === 'serve'
							? (workerConfig) => {
									Object.assign(workerConfig, {
										unsafe: {
											bindings: [
												{
													name: 'CACHE',
													type: 'volatile_cache',
													cache_id: 'volatile-cache-test-34169769',
													max_keys: 64,
													max_value_size: 1_024,
													max_total_value_size: 65_536,
												},
											],
										},
									});
								}
							: undefined,
				},
			],
		}),
		reactRouter(),
	],
}));
