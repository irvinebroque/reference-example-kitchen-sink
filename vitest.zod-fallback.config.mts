import { defineConfig } from 'vitest/config';

export default defineConfig({
	define: {
		__ZOD_COMPILER_MODE__: JSON.stringify('fallback'),
	},
	test: {
		environment: 'node',
		include: ['test/unit/schemas.spec.ts'],
	},
});
