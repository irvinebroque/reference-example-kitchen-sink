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
													cache_id: 'reference-example-kitchen-sink-statsig-config-specs',
													max_keys: 4,
													max_value_size: 67_108_864,
													max_total_value_size: 134_217_728,
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
