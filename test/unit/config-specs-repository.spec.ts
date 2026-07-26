import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ConfigSpecsRepository,
	type CachedConfigSpecs,
	type ConfigSpecsCacheBinding,
} from '../../workers/statsig/config-specs-repository';
import { configSpecsFixture } from '../fixtures/config-specs';

class MemoryConfigSpecsCache implements ConfigSpecsCacheBinding {
	value: CachedConfigSpecs | undefined;
	deletedKeys: string[] = [];

	async read(_key: string, fallback: () => Promise<{ value: CachedConfigSpecs; expiration: number }>): Promise<CachedConfigSpecs> {
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

function cachedConfigSpecs(document = configSpecsFixture, expiresAt = Date.now() + 60_000): CachedConfigSpecs {
	return {
		rawJson: JSON.stringify(document),
		expiresAt,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('config specs repository', () => {
	it('initializes the official client once and does not retain raw JSON in the snapshot', async () => {
		const fetchConfigSpecs = async () => {
			throw new Error('cache miss was not expected');
		};
		const cache = new MemoryConfigSpecsCache();
		cache.value = cachedConfigSpecs();
		const repository = new ConfigSpecsRepository('secret-test-cache', cache, fetchConfigSpecs, 60);
		const snapshot = await repository.get();
		const bootstrap = snapshot.client.getClientInitializeResponse({ userID: 'demo:user' }, { clientSDKKey: 'client-test', hash: 'none' });

		expect(snapshot.time).toBe(String(configSpecsFixture.time));
		expect(snapshot).not.toHaveProperty('rawJson');
		expect(bootstrap?.feature_gates.reference_gate?.value).toBe(true);
		expect((await repository.get()).client).toBe(snapshot.client);
	});

	it('uses the cached absolute expiry instead of extending TTL when installing a snapshot', async () => {
		const now = 10_000;
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const fetchConfigSpecs = async () => {
			throw new Error('cache miss was not expected');
		};
		const cache = new MemoryConfigSpecsCache();
		cache.value = cachedConfigSpecs(configSpecsFixture, now + 250);
		const repository = new ConfigSpecsRepository('secret-test-expiry', cache, fetchConfigSpecs, 60);
		const snapshot = await repository.get();
		expect(snapshot.expiresAt).toBe(now + 250);
	});

	it('rejects config specs the official client cannot initialize', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const fetchConfigSpecs = async () => {
			throw new Error('cache miss was not expected');
		};
		const cache = new MemoryConfigSpecsCache();
		cache.value = cachedConfigSpecs({ time: configSpecsFixture.time });
		const repository = new ConfigSpecsRepository('secret-test-invalid', cache, fetchConfigSpecs, 60);
		await expect(repository.get()).rejects.toThrow('Statsig config specs failed to initialize');
	});

	it('expires lazily and replaces the isolate-local client when config specs time changes', async () => {
		let now = 20_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const refreshedConfigSpecs = { ...configSpecsFixture, time: configSpecsFixture.time + 1 };
		const fetchConfigSpecs = async () => JSON.stringify(refreshedConfigSpecs);
		const cache = new MemoryConfigSpecsCache();
		cache.value = cachedConfigSpecs(configSpecsFixture, now + 10);
		const repository = new ConfigSpecsRepository('secret-test-time', cache, fetchConfigSpecs, 60);
		const initial = await repository.get();

		now += 11;
		const refreshed = await repository.get();

		expect(refreshed.time).toBe(String(refreshedConfigSpecs.time));
		expect(refreshed.client).not.toBe(initial.client);
	});

	it('clears local and volatile state during explicit invalidation', async () => {
		const fetchConfigSpecs = async () => JSON.stringify(configSpecsFixture);
		const cache = new MemoryConfigSpecsCache();
		cache.value = cachedConfigSpecs();
		const repository = new ConfigSpecsRepository('secret-test-invalidation', cache, fetchConfigSpecs, 60);
		const initial = await repository.get();

		repository.invalidate();
		const reloaded = await repository.get();

		expect(cache.deletedKeys).toEqual(['statsig-config-specs-v1']);
		expect(reloaded.client).not.toBe(initial.client);
	});

	it('returns last-known-good data when TTL reload fails', async () => {
		let now = 30_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const fetchConfigSpecs = async () => {
			throw new Error('source unavailable');
		};
		const cache = new MemoryConfigSpecsCache();
		cache.value = cachedConfigSpecs(configSpecsFixture, now + 10);
		const repository = new ConfigSpecsRepository('secret-test-stale', cache, fetchConfigSpecs, 60);
		await repository.get();

		now += 11;
		const stale = await repository.get();

		expect(stale.stale).toBe(true);
		expect(stale.time).toBe(String(configSpecsFixture.time));
	});
});
