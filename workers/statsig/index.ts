import { WorkerEntrypoint } from 'cloudflare:workers';
import {
	ConfigSpecsRepository,
	configSpecsCacheBackendSetting,
	configSpecsCacheBindingForBackend,
	type ConfigSpecsCacheBackend,
	type ConfigSpecsCacheBinding,
} from './config-specs-repository';
import { handleDecisionRequest, type DecisionCacheProps } from './decision-handler';
import { handleGatewayRequest } from './gateway-handler';
import { handleHealthRequest } from './health-handler';
import { positiveNumberSetting } from './responses';

interface ConfigSpecsRepositoryState {
	backend: ConfigSpecsCacheBackend;
	cache: ConfigSpecsCacheBinding | undefined;
	serverSecret: string;
	ttlSeconds: number;
	networkLoggingEnabled: boolean;
	repository: ConfigSpecsRepository;
}

let configSpecsRepositoryState: ConfigSpecsRepositoryState | undefined;

function hasSameRepositorySettings(
	state: ConfigSpecsRepositoryState,
	settings: Omit<ConfigSpecsRepositoryState, 'repository'>,
): boolean {
	return (
		state.backend === settings.backend &&
		state.serverSecret === settings.serverSecret &&
		state.ttlSeconds === settings.ttlSeconds &&
		state.networkLoggingEnabled === settings.networkLoggingEnabled
	);
}

function getConfigSpecsRepository(env: StatsigEnv): ConfigSpecsRepository {
	const backend = configSpecsCacheBackendSetting(env.CONFIG_SPECS_CACHE_BACKEND);
	const cache = configSpecsCacheBindingForBackend(backend, env.CACHE);
	const settings = {
		backend,
		cache,
		serverSecret: env.STATSIG_SERVER_SECRET,
		ttlSeconds: positiveNumberSetting(env.CONFIG_SPECS_TTL_SECONDS, 300),
		networkLoggingEnabled:
			env.STATSIG_EXPOSURE_LOGGING_ENABLED === 'true' ||
			env.STATSIG_PRODUCT_EVENT_LOGGING_ENABLED === 'true',
	};

	if (configSpecsRepositoryState && hasSameRepositorySettings(configSpecsRepositoryState, settings)) {
		return configSpecsRepositoryState.repository;
	}

	const repository = new ConfigSpecsRepository(
		settings.serverSecret,
		settings.cache,
		async (signal) => {
			const response = await fetch('https://api.statsig.com/v1/download_config_specs', {
				headers: {
					Accept: 'application/json',
					'statsig-api-key': settings.serverSecret,
				},
				signal,
			});
			if (!response.ok) {
				await response.body?.cancel();
				throw new Error(`Statsig config specs request failed with ${response.status}`);
			}
			return response.text();
		},
		settings.ttlSeconds,
		settings.networkLoggingEnabled,
	);
	configSpecsRepositoryState = { ...settings, repository };
	return repository;
}

export class FeatureGatewayEntrypoint extends WorkerEntrypoint<StatsigEnv> {
	fetch(request: Request): Promise<Response> {
		return handleGatewayRequest(request, this.env, {
			decisionEntrypoint: this.ctx.exports.DecisionCacheEntrypoint,
			repository: getConfigSpecsRepository(this.env),
			scheduleBackgroundTask: (promise) => this.ctx.waitUntil(promise),
		});
	}
}

export class DecisionCacheEntrypoint extends WorkerEntrypoint<StatsigEnv, DecisionCacheProps> {
	fetch(request: Request): Promise<Response> {
		return handleDecisionRequest(
			request,
			this.env,
			getConfigSpecsRepository(this.env),
			this.ctx.props,
			(promise) => this.ctx.waitUntil(promise),
		);
	}
}

export default {
	fetch(request: Request, env: StatsigEnv): Response {
		return handleHealthRequest(request, env);
	},
} satisfies ExportedHandler<StatsigEnv>;
