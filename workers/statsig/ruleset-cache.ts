import { StatsigServerlessClient } from '@statsig/serverless-client';

const RULESET_CACHE_KEY = 'statsig-ruleset-v1';

export interface RulesetSnapshot {
	generation: string;
	client: StatsigServerlessClient;
	loadedAt: number;
	expiresAt: number;
	stale: boolean;
}

export interface CachedRuleset {
	rawJson: string;
	expiresAt: number;
}

export interface VolatileValueCacheBinding {
	read(key: string, fallback: () => Promise<{ value: CachedRuleset; expiration: number }>): Promise<CachedRuleset>;
	delete(key: string): void;
}

function readGeneration(rawJson: string): string {
	const document: unknown = JSON.parse(rawJson);
	if (!document || typeof document !== 'object' || !('time' in document)) {
		throw new TypeError('Statsig config specs are missing a generation time');
	}
	const time = (document as { time?: unknown }).time;
	if (typeof time !== 'number' || !Number.isFinite(time)) {
		throw new TypeError('Statsig config specs contain an invalid generation time');
	}
	return String(time);
}

function createClient(serverSecret: string, rawJson: string): StatsigServerlessClient {
	const client = new StatsigServerlessClient(serverSecret, {
		loggingEnabled: 'disabled',
		networkConfig: { preventAllNetworkTraffic: true },
	});
	client.dataAdapter.setData(rawJson);
	const details = client.initializeSync();
	if (!details.success || details.source !== 'Bootstrap') {
		throw details.error ?? new Error('Statsig config specs failed to initialize');
	}
	return client;
}

export class RulesetRepository {
	private lastKnownGood: RulesetSnapshot | undefined;

	constructor(
		private readonly serverSecret: string,
		private readonly cache: VolatileValueCacheBinding,
		private readonly fetchRuleset: (signal: AbortSignal) => Promise<string>,
		private readonly ttlSeconds: number,
		private readonly timeoutMs = 8_000,
	) {}

	async get(): Promise<RulesetSnapshot> {
		const current = this.lastKnownGood;
		if (current && current.expiresAt > Date.now()) return current;

		try {
			const cached = await this.cache.read(RULESET_CACHE_KEY, () => this.fetchFresh());
			return this.install(cached);
		} catch (error) {
			return this.staleOrThrow(error);
		}
	}

	invalidate(): void {
		this.cache.delete(RULESET_CACHE_KEY);
		this.lastKnownGood = undefined;
	}

	private async fetchFresh(): Promise<{ value: CachedRuleset; expiration: number }> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const expiresAt = Date.now() + this.ttlSeconds * 1_000;
			return {
				value: {
					rawJson: await this.fetchRuleset(controller.signal),
					expiresAt,
				},
				expiration: expiresAt,
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	private install(cached: CachedRuleset): RulesetSnapshot {
		const loadedAt = Date.now();
		const generation = readGeneration(cached.rawJson);
		const client =
			this.lastKnownGood?.generation === generation ? this.lastKnownGood.client : createClient(this.serverSecret, cached.rawJson);
		const snapshot = {
			generation,
			client,
			loadedAt,
			expiresAt: cached.expiresAt,
			stale: false,
		};
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
