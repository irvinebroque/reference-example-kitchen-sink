import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleAdminRequest, type DecisionPurger } from './admin-handler';
import { ConfigSpecsRepository } from './config-specs-repository';
import { handleDecisionRequest } from './decision-handler';
import { handleGatewayRequest, type DecisionEntrypoint } from './gateway-handler';
import { positiveNumberSetting } from './responses';

let configSpecsRepository: ConfigSpecsRepository | undefined;

type DecisionCacheLoopback = DecisionEntrypoint & DecisionPurger;

function getDecisionCacheLoopback(exports: Cloudflare.Exports): DecisionCacheLoopback {
	const loopback: unknown = Reflect.get(exports, 'DecisionCacheEntrypoint');
	if (
		!loopback ||
		typeof loopback !== 'object' ||
		typeof Reflect.get(loopback, 'fetch') !== 'function' ||
		typeof Reflect.get(loopback, 'purgeApplicationDecisions') !== 'function'
	) {
		throw new Error('Decision cache loopback is unavailable');
	}
	return loopback as DecisionCacheLoopback;
}

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
		return handleGatewayRequest(request, this.env, getDecisionCacheLoopback(this.ctx.exports));
	}
}

export class DecisionCacheEntrypoint extends WorkerEntrypoint<StatsigEnv> {
	fetch(request: Request): Promise<Response> {
		return handleDecisionRequest(request, this.env, getConfigSpecsRepository(this.env));
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
			getDecisionCacheLoopback(ctx.exports),
		);
	},
} satisfies ExportedHandler<StatsigEnv>;
