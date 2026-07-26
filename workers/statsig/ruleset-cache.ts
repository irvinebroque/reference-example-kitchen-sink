import { compileRuleset } from './ruleset-compiler';
import type { CompiledRuleset } from './ruleset-model';
import { statsigRulesetSchema } from './ruleset-schema';

const RULESET_CACHE_KEY = 'statsig-ruleset-v1';

export interface RulesetSnapshot {
	generation: string;
	rawJson: string;
	ruleset: CompiledRuleset;
	loadedAt: number;
	expiresAt: number;
	stale: boolean;
}

export interface RulesetSource {
	fetchRuleset(signal: AbortSignal): Promise<string>;
}

export interface VolatileValueCacheBinding {
	read<T>(key: string, fallback: () => Promise<{ value: T; expiration: number }>): Promise<T>;
	delete(key: string): void;
}

export interface RulesetValueCache {
	read(key: string, fallback: () => Promise<{ value: string; expiration: number }>): Promise<string>;
	replace(key: string, value: string, expiration: number): Promise<string>;
}

export class VolatileRulesetValueCache implements RulesetValueCache {
	constructor(private readonly binding: VolatileValueCacheBinding) {}

	read(key: string, fallback: () => Promise<{ value: string; expiration: number }>): Promise<string> {
		return this.binding.read(key, fallback);
	}

	async replace(key: string, value: string, expiration: number): Promise<string> {
		this.binding.delete(key);
		return this.binding.read(key, async () => ({ value, expiration }));
	}
}

export class StatsigRulesetSource implements RulesetSource {
	constructor(private readonly serverSecret: string) {}

	async fetchRuleset(signal: AbortSignal): Promise<string> {
		const response = await fetch('https://api.statsig.com/v1/download_config_specs', {
			headers: {
				Accept: 'application/json',
				'statsig-api-key': this.serverSecret,
			},
			signal,
		});
		if (!response.ok) {
			throw new Error(`Statsig ruleset request failed with ${response.status}`);
		}
		return response.text();
	}
}

function parseSnapshot(
	rawJson: string,
	ttlSeconds: number,
	previous: RulesetSnapshot | undefined,
	loadedAt = Date.now(),
): RulesetSnapshot {
	const document = statsigRulesetSchema.parse(JSON.parse(rawJson));
	const generation = String(document.time);
	return {
		generation,
		rawJson,
		ruleset: previous?.generation === generation ? previous.ruleset : compileRuleset(document),
		loadedAt,
		expiresAt: loadedAt + ttlSeconds * 1_000,
		stale: false,
	};
}

export class RulesetRepository {
	private lastKnownGood: RulesetSnapshot | undefined;

	constructor(
		private readonly source: RulesetSource,
		private readonly cache: RulesetValueCache,
		private readonly ttlSeconds: number,
		private readonly timeoutMs = 8_000,
	) {}

	async get(): Promise<RulesetSnapshot> {
		const current = this.lastKnownGood;
		if (current && current.expiresAt > Date.now()) return current;

		try {
			const rawJson = await this.cache.read(RULESET_CACHE_KEY, () => this.fetchFresh());
			return this.install(rawJson);
		} catch (error) {
			return this.staleOrThrow(error);
		}
	}

	async refresh(): Promise<RulesetSnapshot> {
		try {
			const fresh = await this.fetchFresh();
			const candidate = parseSnapshot(fresh.value, this.ttlSeconds, this.lastKnownGood);
			const rawJson = await this.cache.replace(RULESET_CACHE_KEY, fresh.value, fresh.expiration);
			return rawJson === fresh.value ? this.installSnapshot(candidate) : this.install(rawJson);
		} catch (error) {
			return this.staleOrThrow(error);
		}
	}

	private async fetchFresh(): Promise<{ value: string; expiration: number }> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			return {
				value: await this.source.fetchRuleset(controller.signal),
				expiration: Date.now() + this.ttlSeconds * 1_000,
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	private install(rawJson: string): RulesetSnapshot {
		return this.installSnapshot(parseSnapshot(rawJson, this.ttlSeconds, this.lastKnownGood));
	}

	private installSnapshot(snapshot: RulesetSnapshot): RulesetSnapshot {
		this.lastKnownGood = snapshot;
		return snapshot;
	}

	private staleOrThrow(error: unknown): RulesetSnapshot {
		if (!this.lastKnownGood) throw error;
		return {
			...this.lastKnownGood,
			stale: true,
		};
	}
}
