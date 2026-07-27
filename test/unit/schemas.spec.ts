import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
	applicationDecisionsSchema,
	featureServiceRequestSchema,
	featureServiceResponseSchema,
	featureSubjectSchema,
} from '../../shared/feature-contract';
import { welcomeConfigSchema } from '../../workers/statsig/provider-contract';
import { targetingUserSchema } from '../../workers/statsig/targeting-user-contract';

const decisions = {
	statsigGateEnabled: true,
	welcomeMessage: 'hello',
};

const diagnostics = {
	evaluatorVersion: 'test',
	configurationGeneration: '1',
	configurationStale: false,
	evaluationDurationMs: 1,
	payloadBytes: 100,
};

describe(`feature service contracts (${__ZOD_COMPILER_MODE__})`, () => {
	it('uses compiled bags in production-like tests and ordinary Zod schemas in fallback tests', () => {
		const schema = featureSubjectSchema as unknown as Record<string, unknown>;
		expect(typeof schema.parse).toBe('function');
		expect(typeof schema.safeParse).toBe('function');
		expect('_zod' in schema).toBe(__ZOD_COMPILER_MODE__ === 'fallback');
	});

	it('normalizes feature subjects and strips unknown properties', () => {
		expect(
			featureSubjectSchema.parse({
				id: ' demo:user ',
				email: ' User@Example.com ',
				ignored: 'value',
			}),
		).toEqual({
			id: 'demo:user',
			email: 'user@example.com',
		});
	});

	it('strips unknown properties at every application contract object boundary', () => {
		expect(
			featureServiceRequestSchema.parse({
				ignored: 'request',
				subject: {
					id: 'demo:user',
					ignored: 'subject',
				},
			}),
		).toEqual({
			subject: {
				id: 'demo:user',
			},
		});

		expect(applicationDecisionsSchema.parse({ ...decisions, ignored: 'decisions' })).toEqual(decisions);

		expect(
			featureServiceResponseSchema.parse({
				ignored: 'response',
				decisions: {
					...decisions,
					ignored: 'decisions',
				},
				diagnostics: {
					...diagnostics,
					ignored: 'diagnostics',
				},
			}),
		).toEqual({ decisions, diagnostics });
	});

	it('strips unknown properties at every provider contract object boundary', () => {
		expect(welcomeConfigSchema.parse({ message: 'hello', ignored: 'config' })).toEqual({ message: 'hello' });

		expect(
			targetingUserSchema.parse({
				userID: 'demo:user',
				email: 'user@example.com',
				customIDs: { applicationID: 'reference-app' },
				custom: {
					applicationId: 'reference-app',
					roles: ['reader'],
				},
				statsigEnvironment: {
					tier: 'test',
					ignored: 'environment',
				},
				ignored: 'user',
			}),
		).toEqual({
			userID: 'demo:user',
			email: 'user@example.com',
			customIDs: { applicationID: 'reference-app' },
			custom: {
				applicationId: 'reference-app',
				roles: ['reader'],
			},
			statsigEnvironment: {
				tier: 'test',
			},
		});
	});

	it('returns compatible safeParse success and failure shapes', () => {
		const success = featureSubjectSchema.safeParse({ id: ' demo:user ' });
		expect(success).toEqual({
			success: true,
			data: {
				id: 'demo:user',
			},
		});

		const failure = featureSubjectSchema.safeParse({ id: '', email: 'not-email' });
		expect(failure.success).toBe(false);
		if (!failure.success) {
			expect(failure.error).toBeInstanceOf(ZodError);
			expect(failure.error.issues).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ path: ['id'] }),
					expect.objectContaining({ path: ['email'] }),
				]),
			);
		}
	});

	it('throws compatible Zod errors from parse()', () => {
		expect(() => featureSubjectSchema.parse({ id: '' })).toThrow(ZodError);
	});

	it('rejects malformed application decisions and response diagnostics', () => {
		expect(
			applicationDecisionsSchema.safeParse({
				statsigGateEnabled: 'true',
				welcomeMessage: 'hello',
			}).success,
		).toBe(false);

		expect(
			featureServiceResponseSchema.safeParse({
				decisions,
				diagnostics: {
					...diagnostics,
					configurationStale: 'false',
				},
			}).success,
		).toBe(false);
	});

	it('rejects invalid provider configuration and targeting-user values', () => {
		expect(welcomeConfigSchema.safeParse({ message: 42 }).success).toBe(false);
		expect(
			targetingUserSchema.safeParse({
				userID: '',
				email: 'not-email',
				custom: {
					unsupported: ['valid', 42],
				},
				statsigEnvironment: { tier: '' },
			}).success,
		).toBe(false);
	});
});
