import type { StatsigServerlessClient } from '@statsig/serverless-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeStatsigFlushes } from '../../workers/statsig/flush-observer';

type Listener = (event: never) => void;

function observableClient(): {
	client: Pick<StatsigServerlessClient, 'on'>;
	listeners: Map<string, Listener>;
} {
	const listeners = new Map<string, Listener>();
	return {
		client: {
			on(event, listener) {
				listeners.set(event, listener as Listener);
			},
		} as Pick<StatsigServerlessClient, 'on'>,
		listeners,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Statsig flush observer', () => {
	it('logs a sanitized successful batch size without event contents', () => {
		const successLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const { client, listeners } = observableClient();
		observeStatsigFlushes(client);

		listeners.get('logs_flushed')?.({
			name: 'logs_flushed',
			events: [{ private: 'event contents' }, { private: 'other contents' }],
		} as never);

		expect(successLog).toHaveBeenCalledWith(
			JSON.stringify({
				event: 'statsig_logs_flushed',
				batchSize: 2,
			}),
		);
		expect(successLog.mock.calls.flat().join(' ')).not.toContain('event contents');
	});

	it('logs sanitized NetworkError failures and ignores unrelated SDK errors', () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { client, listeners } = observableClient();
		observeStatsigFlushes(client);

		listeners.get('error')?.({
			name: 'error',
			error: new TypeError('private network details'),
			tag: 'NetworkError',
			requestArgs: { private: 'request contents' },
		} as never);
		listeners.get('error')?.({
			name: 'error',
			error: new Error('unrelated'),
			tag: 'OtherError',
		} as never);

		expect(errorLog).toHaveBeenCalledTimes(1);
		expect(errorLog).toHaveBeenCalledWith(
			JSON.stringify({
				event: 'statsig_flush_network_error',
				errorType: 'NetworkError',
			}),
		);
		const serializedLogs = errorLog.mock.calls.flat().join(' ');
		expect(serializedLogs).not.toContain('private network details');
		expect(serializedLogs).not.toContain('request contents');
	});
});
