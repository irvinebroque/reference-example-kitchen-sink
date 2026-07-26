import { statsigRulesetSchema, type StatsigRuleset } from './ruleset-schema';

export interface RulesetSnapshot {
	generation: string;
	rawJson: string;
	ruleset: StatsigRuleset;
	loadedAt: number;
	expiresAt: number;
	stale: boolean;
}

export interface RulesetSource {
	fetchRuleset(signal: AbortSignal): Promise<string>;
}

export interface VolatileValueCache {
	read<T>(key: string, fallback: () => Promise<{ value: T; expiration: number }>): Promise<T>;
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

function parseSnapshot(rawJson: string, ttlSeconds: number, loadedAt = Date.now()): RulesetSnapshot {
	const ruleset = statsigRulesetSchema.parse(JSON.parse(rawJson));
	return {
		generation: String(ruleset.time),
		rawJson,
		ruleset,
		loadedAt,
		expiresAt: loadedAt + ttlSeconds * 1_000,
		stale: false,
	};
}

export class RulesetRepository {
	private lastKnownGood: RulesetSnapshot | undefined;

	constructor(
		private readonly source: RulesetSource,
		private readonly cache: VolatileValueCache,
		private readonly ttlSeconds: number,
		private readonly timeoutMs = 8_000,
	) {}

	async get(forceRefresh = false): Promise<RulesetSnapshot> {
		const now = Date.now();
		const current = this.lastKnownGood;
		if (!forceRefresh && current && current.expiresAt > now) {
			return current;
		}

		try {
			const fetchFresh = async () => {
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
			};
			const rawJson = forceRefresh ? (await fetchFresh()).value : await this.cache.read('statsig-ruleset-v1', fetchFresh);
			const snapshot = parseSnapshot(rawJson, this.ttlSeconds);
			this.lastKnownGood = snapshot;
			return snapshot;
		} catch (error) {
			const lastKnownGood = this.lastKnownGood;
			if (lastKnownGood) {
				return {
					...lastKnownGood,
					stale: true,
				};
			}
			throw error;
		}
	}
}
