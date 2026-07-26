import { describe, expect, it } from 'vitest';
import { zodCompilerOptions } from '../../zod-compiler.config';

describe('zod compiler configuration', () => {
	it('uses the size-focused, behavior-compatible compiler settings', () => {
		expect(zodCompilerOptions).toEqual({
			schemas: 'auto',
			output: 'bag',
			stripUnknownKeys: true,
			include: [
				'shared/feature-contract.ts',
				'workers/statsig/provider-contract.ts',
				'workers/statsig/targeting-user-contract.ts',
			],
		});
	});

	it('limits build-time discovery to the approved pure schema modules', () => {
		expect(zodCompilerOptions.include).toHaveLength(3);
		expect(zodCompilerOptions.include.every((modulePath) => modulePath.endsWith('-contract.ts'))).toBe(true);
	});
});
