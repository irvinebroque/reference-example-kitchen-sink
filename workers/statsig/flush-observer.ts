import type { StatsigServerlessClient } from '@statsig/serverless-client';

type ObservableStatsigClient = Pick<StatsigServerlessClient, 'on'>;

export function observeStatsigFlushes(client: ObservableStatsigClient): void {
	client.on('logs_flushed', ({ events }) => {
		console.log(
			JSON.stringify({
				event: 'statsig_logs_flushed',
				batchSize: events.length,
			}),
		);
	});
	client.on('error', ({ tag }) => {
		if (tag !== 'NetworkError') return;
		console.error(
			JSON.stringify({
				event: 'statsig_flush_network_error',
				errorType: tag,
			}),
		);
	});
}

export function logUnexpectedStatsigFlushError(error: unknown): void {
	console.error(
		JSON.stringify({
			event: 'statsig_flush_unexpected_error',
			errorType: error instanceof Error ? error.name : 'UnknownError',
		}),
	);
}
