import { describe, expect, it } from 'vitest';
import {
	RulesetRepository,
	VolatileRulesetValueCache,
	type RulesetSource,
	type RulesetValueCache,
	type VolatileValueCacheBinding,
} from '../../workers/statsig/ruleset-cache';
import { rulesetFixture } from '../fixtures/ruleset';

class MemoryRulesetCache implements RulesetValueCache {
	value: string | undefined;
	replacements = 0;

	async read(_key: string, fallback: () => Promise<{ value: string; expiration: number }>): Promise<string> {
		this.value ??= (await fallback()).value;
		return this.value;
	}

	async replace(_key: string, value: string): Promise<string> {
		this.replacements += 1;
		this.value = value;
		return value;
	}
}

describe('ruleset repository', () => {
	it('replaces the volatile cache value through its authoritative key', async () => {
		const calls: string[] = [];
		const binding: VolatileValueCacheBinding = {
			delete(key) {
				calls.push(`delete:${key}`);
			},
			async read(key, fallback) {
				calls.push(`read:${key}`);
				return (await fallback()).value;
			},
		};
		const cache = new VolatileRulesetValueCache(binding);
		expect(await cache.replace('ruleset', 'fresh', Date.now() + 1_000)).toBe('fresh');
		expect(calls).toEqual(['delete:ruleset', 'read:ruleset']);
	});

	it('reads and compiles the ruleset through the configured cache', async () => {
		const source: RulesetSource = {
			async fetchRuleset() {
				throw new Error('cache miss was not expected');
			},
		};
		const cache = new MemoryRulesetCache();
		cache.value = JSON.stringify(rulesetFixture);
		const repository = new RulesetRepository(source, cache, 60);
		const snapshot = await repository.get();
		expect(snapshot.generation).toBe(String(rulesetFixture.time));
		expect(snapshot.ruleset.featureGates[0]?.name).toBe('reference_gate');
	});

	it('publishes explicit refreshes through the same cache snapshot', async () => {
		const refreshedRuleset = { ...rulesetFixture, time: rulesetFixture.time + 1 };
		const source: RulesetSource = {
			async fetchRuleset() {
				return JSON.stringify(refreshedRuleset);
			},
		};
		const cache = new MemoryRulesetCache();
		cache.value = JSON.stringify(rulesetFixture);
		const repository = new RulesetRepository(source, cache, 60);

		await repository.get();
		const refreshed = await repository.refresh();

		expect(refreshed.generation).toBe(String(refreshedRuleset.time));
		expect(cache.replacements).toBe(1);
		expect(JSON.parse(cache.value ?? '').time).toBe(refreshedRuleset.time);
		expect((await repository.get()).generation).toBe(String(refreshedRuleset.time));
	});

	it('reuses the compiled model when a refresh republishes the same generation', async () => {
		const source: RulesetSource = {
			async fetchRuleset() {
				return JSON.stringify(rulesetFixture);
			},
		};
		const cache = new MemoryRulesetCache();
		cache.value = JSON.stringify(rulesetFixture);
		const repository = new RulesetRepository(source, cache, 60);
		const initial = await repository.get();
		const refreshed = await repository.refresh();
		expect(refreshed.ruleset).toBe(initial.ruleset);
	});

	it('returns last-known-good data when refresh fails', async () => {
		const source: RulesetSource = {
			async fetchRuleset() {
				throw new Error('source unavailable');
			},
		};
		const cache = new MemoryRulesetCache();
		cache.value = JSON.stringify(rulesetFixture);
		const repository = new RulesetRepository(source, cache, 60);
		await repository.get();
		const stale = await repository.refresh();
		expect(stale.stale).toBe(true);
		expect(stale.generation).toBe(String(rulesetFixture.time));
	});
});
