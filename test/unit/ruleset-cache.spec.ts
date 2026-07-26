import { describe, expect, it } from 'vitest';
import { RulesetRepository, type RulesetSource, type VolatileValueCache } from '../../workers/statsig/ruleset-cache';
import { rulesetFixture } from '../fixtures/ruleset';

describe('ruleset repository', () => {
	it('reads the ruleset through the configured cache binding', async () => {
		const source: RulesetSource = {
			async fetchRuleset() {
				throw new Error('cache miss was not expected');
			},
		};
		const cache: VolatileValueCache = {
			async read() {
				return JSON.stringify(rulesetFixture);
			},
		};
		const repository = new RulesetRepository(source, cache, 60);
		const snapshot = await repository.get();
		expect(snapshot.generation).toBe(String(rulesetFixture.time));
	});

	it('returns last-known-good data when refresh fails', async () => {
		let fail = false;
		const source: RulesetSource = {
			async fetchRuleset() {
				if (fail) throw new Error('source unavailable');
				return JSON.stringify(rulesetFixture);
			},
		};
		const cache: VolatileValueCache = {
			async read(_key, fallback) {
				return (await fallback()).value;
			},
		};
		const repository = new RulesetRepository(source, cache, 60);
		await repository.get();
		fail = true;
		const stale = await repository.get(true);
		expect(stale.stale).toBe(true);
		expect(stale.generation).toBe(String(rulesetFixture.time));
	});
});
