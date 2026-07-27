import { WorkerEntrypoint } from 'cloudflare:workers';
import { ConfigSpecsRepository } from './config-specs-repository';
import { handleDecisionRequest, type DecisionCacheProps } from './decision-handler';
import { handleGatewayRequest } from './gateway-handler';
import { handleHealthRequest } from './health-handler';
import { positiveNumberSetting } from './responses';

let configSpecsRepository: ConfigSpecsRepository | undefined;

function getConfigSpecsRepository(env: StatsigEnv): ConfigSpecsRepository {
	configSpecsRepository ??= new ConfigSpecsRepository(
		env.STATSIG_SERVER_SECRET,
		env.CACHE,
		async (signal) => {
			const response = await fetch('https://api.statsig.com/v1/download_config_specs', {
				headers: {
					Accept: 'application/json',
					'statsig-api-key': env.STATSIG_SERVER_SECRET,
				},
				signal,
			});
			if (!response.ok) {
				await response.body?.cancel();
				throw new Error(`Statsig config specs request failed with ${response.status}`);
			}
			return response.text();
		},
		positiveNumberSetting(env.CONFIG_SPECS_TTL_SECONDS, 300),
		env.STATSIG_EXPOSURE_LOGGING_ENABLED === 'true' ||
			env.STATSIG_PRODUCT_EVENT_LOGGING_ENABLED === 'true',
	);
	return configSpecsRepository;
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
