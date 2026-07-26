import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleAdminRequest } from './admin-handler';
import { handleEvaluationRequest } from './evaluation-handler';
import { ConfigSpecsRepository } from './config-specs-repository';
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

export class EvaluationEntrypoint extends WorkerEntrypoint<StatsigEnv> {
	fetch(request: Request): Promise<Response> {
		return handleEvaluationRequest(request, this.env, getConfigSpecsRepository(this.env));
	}
}

export default {
	fetch(request: Request, env: StatsigEnv): Promise<Response> {
		return handleAdminRequest(request, env, getConfigSpecsRepository(env));
	},
} satisfies ExportedHandler<StatsigEnv>;
