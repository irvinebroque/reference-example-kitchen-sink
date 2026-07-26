import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleAdminRequest } from './admin-handler';
import { ConfigSpecsRepository } from './config-specs-repository';
import { handleDecisionRequest, type DecisionCacheProps } from './decision-handler';
import { handleGatewayRequest } from './gateway-handler';
import { positiveNumberSetting } from './responses';

let configSpecsRepository: ConfigSpecsRepository | undefined;

function getConfigSpecsRepository(env: StatsigEnv): ConfigSpecsRepository {
	configSpecsRepository ??= new ConfigSpecsRepository(
		env.STATSIG_SERVER_SECRET,
		env.CONFIG_SPECS_CACHE,
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
	);
	return configSpecsRepository;
}

export class FeatureGatewayEntrypoint extends WorkerEntrypoint<StatsigEnv> {
	fetch(request: Request): Promise<Response> {
		return handleGatewayRequest(request, this.env, this.ctx.exports.DecisionCacheEntrypoint);
	}
}

export class DecisionCacheEntrypoint extends WorkerEntrypoint<StatsigEnv, DecisionCacheProps> {
	fetch(request: Request): Promise<Response> {
		return handleDecisionRequest(request, this.env, getConfigSpecsRepository(this.env), this.ctx.props);
	}

	purgeApplicationDecisions(): Promise<CachePurgeResult> {
		const cache = this.ctx.cache;
		if (!cache) throw new Error('Decision cache context is unavailable');
		return cache.purge({
			tags: [`feature-decisions-app-${this.env.APP_ID}`],
		});
	}
}

export default {
	fetch(request: Request, env: StatsigEnv, ctx: ExecutionContext): Promise<Response> {
		return handleAdminRequest(
			request,
			env,
			getConfigSpecsRepository(env),
			ctx.exports.DecisionCacheEntrypoint,
		);
	},
} satisfies ExportedHandler<StatsigEnv>;
