import { describe, expect, it } from 'vitest';
import { evaluatorServiceResponseSchema, targetingUserSchema } from '../../shared/statsig-contract';

describe('internal schemas', () => {
	it('rejects malformed targeting users', () => {
		expect(
			targetingUserSchema.safeParse({
				userID: '',
				statsigEnvironment: { tier: '' },
			}).success,
		).toBe(false);
	});

	it('validates only the consumed bootstrap fields at the Service Binding boundary', () => {
		const envelope = {
			bootstrap: {
				feature_gates: {
					reference_gate: {
						value: true,
						vendorOwnedField: 'ignored',
					},
				},
				user: {
					userID: 'demo:user',
					email: 'user@example.com',
				},
				dynamic_configs: 'not interpreted by this application',
			},
			diagnostics: {
				evaluatorVersion: 'test',
				rulesetGeneration: '1',
				rulesetStale: false,
				evaluatorDurationMs: 1,
				payloadBytes: 100,
			},
		};

		expect(evaluatorServiceResponseSchema.safeParse(envelope).success).toBe(true);
		expect(
			evaluatorServiceResponseSchema.safeParse({
				...envelope,
				bootstrap: {
					...envelope.bootstrap,
					feature_gates: { reference_gate: { value: 'true' } },
				},
			}).success,
		).toBe(false);
	});
});
