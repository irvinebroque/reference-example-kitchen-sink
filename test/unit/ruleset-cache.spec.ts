import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	RulesetRepository,
	type CachedRuleset,
	type VolatileValueCacheBinding,
} from '../../workers/statsig/ruleset-cache';
import { rulesetFixture } from '../fixtures/ruleset';

class MemoryRulesetCache implements VolatileValueCacheBinding {
	value: CachedRuleset | undefined;
	deletedKeys: string[] = [];

	async read(_key: string, fallback: () => Promise<{ value: CachedRuleset; expiration: number }>): Promise<CachedRuleset> {
		if (!this.value || this.value.expiresAt <= Date.now()) {
			this.value = (await fallback()).value;
		}
		return this.value;
	}

	delete(key: string): void {
		this.deletedKeys.push(key);
		this.value = undefined;
	}
}

function cachedRuleset(document = rulesetFixture, expiresAt = Date.now() + 60_000): CachedRuleset {
	return {
		rawJson: JSON.stringify(document),
		expiresAt,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('ruleset repository', () => {
	it('initializes the official client once and does not retain raw JSON in the snapshot', async () => {
		const fetchRuleset = async () => {
			throw new Error('cache miss was not expected');
		};
		const cache = new MemoryRulesetCache();
		cache.value = cachedRuleset();
		const repository = new RulesetRepository('secret-test-cache', cache, fetchRuleset, 60);
		const snapshot = await repository.get();
		const bootstrap = snapshot.client.getClientInitializeResponse({ userID: 'demo:user' }, { clientSDKKey: 'client-test', hash: 'none' });

		expect(snapshot.generation).toBe(String(rulesetFixture.time));
		expect(snapshot).not.toHaveProperty('rawJson');
		expect(bootstrap?.feature_gates.reference_gate?.value).toBe(true);
		expect((await repository.get()).client).toBe(snapshot.client);
	});

	it('uses the cached absolute expiry instead of extending TTL when installing a snapshot', async () => {
		const now = 10_000;
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const fetchRuleset = async () => {
			throw new Error('cache miss was not expected');
		};
		const cache = new MemoryRulesetCache();
		cache.value = cachedRuleset(rulesetFixture, now + 250);
		const repository = new RulesetRepository('secret-test-expiry', cache, fetchRuleset, 60);
		const snapshot = await repository.get();
		expect(snapshot.expiresAt).toBe(now + 250);
	});

	it('rejects config specs the official client cannot initialize', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const fetchRuleset = async () => {
			throw new Error('cache miss was not expected');
		};
		const cache = new MemoryRulesetCache();
		cache.value = cachedRuleset({ time: rulesetFixture.time });
		const repository = new RulesetRepository('secret-test-invalid', cache, fetchRuleset, 60);
		await expect(repository.get()).rejects.toThrow('Statsig config specs failed to initialize');
	});

	it('expires lazily and replaces the isolate-local client when generation changes', async () => {
		let now = 20_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const refreshedRuleset = { ...rulesetFixture, time: rulesetFixture.time + 1 };
		const fetchRuleset = async () => JSON.stringify(refreshedRuleset);
		const cache = new MemoryRulesetCache();
		cache.value = cachedRuleset(rulesetFixture, now + 10);
		const repository = new RulesetRepository('secret-test-generation', cache, fetchRuleset, 60);
		const initial = await repository.get();

		now += 11;
		const refreshed = await repository.get();

		expect(refreshed.generation).toBe(String(refreshedRuleset.time));
		expect(refreshed.client).not.toBe(initial.client);
	});

	it('clears local and volatile state during explicit invalidation', async () => {
		const fetchRuleset = async () => JSON.stringify(rulesetFixture);
		const cache = new MemoryRulesetCache();
		cache.value = cachedRuleset();
		const repository = new RulesetRepository('secret-test-invalidation', cache, fetchRuleset, 60);
		const initial = await repository.get();

		repository.invalidate();
		const reloaded = await repository.get();

		expect(cache.deletedKeys).toEqual(['statsig-ruleset-v1']);
		expect(reloaded.client).not.toBe(initial.client);
	});

	it('returns last-known-good data when TTL reload fails', async () => {
		let now = 30_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const fetchRuleset = async () => {
			throw new Error('source unavailable');
		};
		const cache = new MemoryRulesetCache();
		cache.value = cachedRuleset(rulesetFixture, now + 10);
		const repository = new RulesetRepository('secret-test-stale', cache, fetchRuleset, 60);
		await repository.get();

		now += 11;
		const stale = await repository.get();

		expect(stale.stale).toBe(true);
		expect(stale.generation).toBe(String(rulesetFixture.time));
	});
});
