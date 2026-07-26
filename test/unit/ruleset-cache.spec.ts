import { describe, expect, it } from 'vitest';
import { IsolateVolatileValueCache, RulesetRepository, type RulesetSource } from '../../workers/statsig/ruleset-cache';
import { rulesetFixture } from '../fixtures/ruleset';

describe('ruleset repository', () => {
	it('coalesces concurrent cache fills', async () => {
		let calls = 0;
		const source: RulesetSource = {
			async fetchRuleset() {
				calls += 1;
				await new Promise((resolve) => setTimeout(resolve, 10));
				return JSON.stringify(rulesetFixture);
			},
		};
		const repository = new RulesetRepository(source, new IsolateVolatileValueCache(), 60);
		const [first, second] = await Promise.all([repository.get(), repository.get()]);
		expect(first.generation).toBe(second.generation);
		expect(calls).toBe(1);
	});

	it('returns last-known-good data when refresh fails', async () => {
		let fail = false;
		const source: RulesetSource = {
			async fetchRuleset() {
				if (fail) throw new Error('source unavailable');
				return JSON.stringify(rulesetFixture);
			},
		};
		const repository = new RulesetRepository(source, new IsolateVolatileValueCache(), 60);
		await repository.get();
		fail = true;
		const stale = await repository.get(true);
		expect(stale.stale).toBe(true);
		expect(stale.generation).toBe(String(rulesetFixture.time));
	});
});
