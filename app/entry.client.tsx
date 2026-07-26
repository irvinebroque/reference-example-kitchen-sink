import { StrictMode, startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';
import { StatsigClient } from '@statsig/js-client';
import { StatsigEvaluationsDataAdapter } from '@statsig/js-client/src/StatsigEvaluationsDataAdapter';
import type { BootstrapResponse, CanonicalUser } from '../workers/statsig/schemas';

declare global {
	interface Window {
		__REFERENCE_BOOTSTRAP__?: {
			clientKey: string;
			user: CanonicalUser;
			bootstrap: BootstrapResponse;
		};
		__STATSIG_CLIENT__?: StatsigClient;
	}
}

const referenceBootstrap = window.__REFERENCE_BOOTSTRAP__;
if (referenceBootstrap) {
	const adapter = new StatsigEvaluationsDataAdapter();
	const client = new StatsigClient(
		referenceBootstrap.clientKey,
		{
			userID: referenceBootstrap.user.userID,
			email: referenceBootstrap.user.email,
			customIDs: referenceBootstrap.user.customIDs,
			custom: referenceBootstrap.user.custom,
		},
		{
			dataAdapter: adapter,
			loggingEnabled: 'disabled',
			networkConfig: { preventAllNetworkTraffic: true },
		},
	);
	adapter.setData(JSON.stringify(referenceBootstrap.bootstrap));
	client.initializeSync();
	window.__STATSIG_CLIENT__ = client;
}

startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<HydratedRouter />
		</StrictMode>,
	);
});
