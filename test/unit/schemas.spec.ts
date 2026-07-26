import { describe, expect, it } from 'vitest';
import { bootstrapResponseSchema, targetingUserSchema } from '../../shared/statsig-contract';

describe('internal schemas', () => {
	it('rejects malformed users and bootstrap responses', () => {
		expect(
			targetingUserSchema.safeParse({
				userID: '',
				statsigEnvironment: { tier: '' },
			}).success,
		).toBe(false);
		expect(bootstrapResponseSchema.safeParse({ has_updates: true }).success).toBe(false);
	});
});
