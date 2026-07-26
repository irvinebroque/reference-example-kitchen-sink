import { describe, expect, it } from 'vitest';
import type { TargetingUser } from '../../shared/statsig-contract';
import { canonicalizeUser, createUserCacheKey, verifyUserCacheKey } from '../../shared/user-cache-key';

const user: TargetingUser = {
	userID: 'demo:person',
	email: 'person@example.com',
	customIDs: { applicationID: 'reference-app' },
	custom: { applicationId: 'reference-app', tenantId: 'tenant' },
	statsigEnvironment: { tier: 'test' },
};

describe('canonical user cache key', () => {
	it('is stable across object key order and never exposes email', async () => {
		const reordered: TargetingUser = {
			statsigEnvironment: { tier: 'test' },
			custom: { tenantId: 'tenant', applicationId: 'reference-app' },
			customIDs: { applicationID: 'reference-app' },
			email: 'person@example.com',
			userID: 'demo:person',
		};
		expect(canonicalizeUser(reordered)).toBe(canonicalizeUser(user));
		const key = await createUserCacheKey(user, 'test-secret');
		expect(key).toMatch(/^v1_[a-f0-9]{64}$/);
		expect(key).not.toContain(user.email);
		expect(await verifyUserCacheKey(user, 'test-secret', key)).toBe(true);
	});

	it('changes when targeting input changes', async () => {
		const first = await createUserCacheKey(user, 'test-secret');
		const second = await createUserCacheKey({ ...user, statsigEnvironment: { tier: 'preview' } }, 'test-secret');
		expect(second).not.toBe(first);
	});
});
