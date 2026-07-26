import { describe, expect, it } from 'vitest';
import { bootstrapResponseSchema, canonicalUserSchema } from '../../workers/statsig/schemas';

describe('internal schemas', () => {
	it('rejects malformed users and bootstrap responses', () => {
		expect(
			canonicalUserSchema.safeParse({
				userID: '',
				statsigEnvironment: { tier: '' },
			}).success,
		).toBe(false);
		expect(bootstrapResponseSchema.safeParse({ has_updates: true }).success).toBe(false);
	});
});
