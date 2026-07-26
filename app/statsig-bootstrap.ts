import { StatsigClient } from '@statsig/js-client';
import { StatsigEvaluationsDataAdapter } from '@statsig/js-client/src/StatsigEvaluationsDataAdapter';
import type { ReferenceBootstrap } from '../shared/statsig-contract';

declare global {
	interface Window {
		__REFERENCE_BOOTSTRAP__?: ReferenceBootstrap;
		__STATSIG_CLIENT__?: StatsigClient;
	}
}

export function initializeStatsigFromBootstrap(bootstrap: ReferenceBootstrap | undefined): void {
	if (!bootstrap) return;

	const adapter = new StatsigEvaluationsDataAdapter();
	const client = new StatsigClient(bootstrap.clientKey, bootstrap.user, {
		dataAdapter: adapter,
		loggingEnabled: 'disabled',
		networkConfig: { preventAllNetworkTraffic: true },
	});
	adapter.setData(JSON.stringify(bootstrap.bootstrap));
	client.initializeSync();
	window.__STATSIG_CLIENT__ = client;
}
