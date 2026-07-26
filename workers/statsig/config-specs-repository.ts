import { StatsigServerlessClient } from '@statsig/serverless-client';

const CONFIG_SPECS_CACHE_KEY = 'statsig-config-specs-v1';

export interface ConfigSpecsSnapshot {
	time: string;
	client: StatsigServerlessClient;
	expiresAt: number;
	stale: boolean;
}

export interface CachedConfigSpecs {
	rawJson: string;
	expiresAt: number;
}

export interface ConfigSpecsCacheBinding {
	read(key: string, fallback: () => Promise<{ value: CachedConfigSpecs; expiration: number }>): Promise<CachedConfigSpecs>;
	delete(key: string): void;
}

function readConfigSpecsTime(rawJson: string): string {
	const document: unknown = JSON.parse(rawJson);
	if (!document || typeof document !== 'object' || !('time' in document)) {
		throw new TypeError('Statsig config specs are missing a time');
	}
	const time = (document as { time?: unknown }).time;
	if (typeof time !== 'number' || !Number.isFinite(time)) {
		throw new TypeError('Statsig config specs contain an invalid time');
	}
	return String(time);
}

function createClientFromConfigSpecs(serverSecret: string, rawJson: string): StatsigServerlessClient {
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

export class ConfigSpecsRepository {
	private lastKnownGood: ConfigSpecsSnapshot | undefined;

	constructor(
		private readonly serverSecret: string,
		private readonly configSpecsCache: ConfigSpecsCacheBinding,
		private readonly fetchConfigSpecs: (signal: AbortSignal) => Promise<string>,
		private readonly ttlSeconds: number,
		private readonly timeoutMs = 8_000,
	) {}

	async get(): Promise<ConfigSpecsSnapshot> {
		const current = this.lastKnownGood;
		if (current && current.expiresAt > Date.now()) return current;

		try {
			const cached = await this.configSpecsCache.read(CONFIG_SPECS_CACHE_KEY, () => this.fetchFreshConfigSpecs());
			return this.install(cached);
		} catch (error) {
			return this.staleOrThrow(error);
		}
	}

	invalidate(): void {
		this.configSpecsCache.delete(CONFIG_SPECS_CACHE_KEY);
		this.lastKnownGood = undefined;
	}

	private async fetchFreshConfigSpecs(): Promise<{ value: CachedConfigSpecs; expiration: number }> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const expiresAt = Date.now() + this.ttlSeconds * 1_000;
			return {
				value: {
					rawJson: await this.fetchConfigSpecs(controller.signal),
					expiresAt,
				},
				expiration: expiresAt,
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	private install(cached: CachedConfigSpecs): ConfigSpecsSnapshot {
		const time = readConfigSpecsTime(cached.rawJson);
		const client =
			this.lastKnownGood?.time === time
				? this.lastKnownGood.client
				: createClientFromConfigSpecs(this.serverSecret, cached.rawJson);
		const snapshot = {
			time,
			client,
			expiresAt: cached.expiresAt,
			stale: false,
		};
		this.lastKnownGood = snapshot;
		return snapshot;
	}

	private staleOrThrow(error: unknown): ConfigSpecsSnapshot {
		if (!this.lastKnownGood) throw error;
		return {
			...this.lastKnownGood,
			stale: true,
		};
	}
}
