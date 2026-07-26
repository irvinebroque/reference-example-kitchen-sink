import { defineConfig } from 'vitest/config';
import { compiledZodSchemas } from './zod-compiler.config';

export default defineConfig({
	define: {
		__ZOD_COMPILER_MODE__: JSON.stringify('compiled'),
	},
	plugins: [compiledZodSchemas()],
	test: {
		environment: 'node',
		include: ['test/unit/**/*.spec.ts'],
	},
});
