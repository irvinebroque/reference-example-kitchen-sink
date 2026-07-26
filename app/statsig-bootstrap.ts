import { StatsigClient } from '@statsig/js-client';
import type { ReferenceBootstrap } from '../shared/statsig-contract';

declare global {
	interface Window {
		__REFERENCE_BOOTSTRAP__?: ReferenceBootstrap;
		__STATSIG_CLIENT__?: StatsigClient;
	}
}

export function initializeStatsigFromBootstrap(bootstrap: ReferenceBootstrap | undefined): void {
	if (!bootstrap) return;

	const client = new StatsigClient(bootstrap.clientKey, bootstrap.user, {
		loggingEnabled: 'disabled',
		networkConfig: { preventAllNetworkTraffic: true },
	});
	client.dataAdapter.setData(JSON.stringify(bootstrap.bootstrap));
	client.initializeSync();
	window.__STATSIG_CLIENT__ = client;
}
