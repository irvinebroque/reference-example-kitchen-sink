import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { builtinModules } from 'node:module';
import { defineConfig } from 'vitest/config';

const nodeBuiltins = [...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)];

export default defineConfig({
	plugins: [
		cloudflareTest({
			miniflare: {
				serviceBindings: {
					FEATURE_SERVICE: {
						network: {
							deny: ['0.0.0.0/0', '::/0'],
						},
					},
				},
			},
			wrangler: {
				configPath: './wrangler.jsonc',
			},
		}),
	],
	test: {
		deps: {
			optimizer: {
				ssr: {
					enabled: true,
					include: ['next-auth', 'next-auth/providers/credentials'],
					rolldownOptions: {
						external: nodeBuiltins,
					},
				},
			},
		},
		include: ['test/workers/**/*.spec.ts'],
	},
});
