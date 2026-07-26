import { describe, expect, it } from 'vitest';
import {
	applicationDecisionsSchema,
	featureServiceResponseSchema,
	featureSubjectSchema,
} from '../../shared/feature-contract';

describe('feature service contract', () => {
	it('accepts and normalizes valid feature subjects', () => {
		expect(
			featureSubjectSchema.parse({
				id: ' demo:user ',
				email: ' User@Example.com ',
			}),
		).toEqual({
			id: 'demo:user',
			email: 'user@example.com',
		});
	});

	it('rejects empty IDs and malformed email addresses', () => {
		expect(featureSubjectSchema.safeParse({ id: '' }).success).toBe(false);
		expect(featureSubjectSchema.safeParse({ id: 'demo:user', email: 'not-email' }).success).toBe(false);
	});

	it('accepts application decisions and rejects wrong decision types', () => {
		expect(
			applicationDecisionsSchema.safeParse({
				showReferenceExperience: true,
				welcomeMessage: 'hello',
			}).success,
		).toBe(true);
		expect(
			applicationDecisionsSchema.safeParse({
				showReferenceExperience: 'true',
				welcomeMessage: 'hello',
			}).success,
		).toBe(false);
	});

	it('rejects malformed diagnostics', () => {
		const envelope = {
			decisions: {
				showReferenceExperience: true,
				welcomeMessage: 'hello',
			},
			diagnostics: {
				evaluatorVersion: 'test',
				configurationGeneration: '1',
				configurationStale: false,
				evaluationDurationMs: 1,
				payloadBytes: 100,
			},
		};

		expect(featureServiceResponseSchema.safeParse(envelope).success).toBe(true);
		expect(
			featureServiceResponseSchema.safeParse({
				...envelope,
				diagnostics: {
					...envelope.diagnostics,
					configurationStale: 'false',
				},
			}).success,
		).toBe(false);
	});
});
