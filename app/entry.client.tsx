import { StrictMode, startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';
import { initializeStatsigFromBootstrap } from './statsig-bootstrap';

initializeStatsigFromBootstrap(window.__REFERENCE_BOOTSTRAP__);

startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<HydratedRouter />
		</StrictMode>,
	);
});
