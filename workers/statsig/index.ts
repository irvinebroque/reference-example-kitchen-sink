import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleAdminRequest } from './admin-handler';
import { handleEvaluationRequest } from './evaluation-handler';
import { RulesetRepository } from './ruleset-cache';
import { positiveNumberSetting } from './responses';

let repository: RulesetRepository | undefined;

function getRulesetRepository(env: StatsigEnv): RulesetRepository {
	repository ??= new RulesetRepository(
		env.STATSIG_SERVER_SECRET,
		env.RULESET_CACHE,
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
				throw new Error(`Statsig ruleset request failed with ${response.status}`);
			}
			return response.text();
		},
		positiveNumberSetting(env.RULESET_TTL_SECONDS, 300),
	);
	return repository;
}

export class EvaluationEntrypoint extends WorkerEntrypoint<StatsigEnv> {
	fetch(request: Request): Promise<Response> {
		return handleEvaluationRequest(request, this.env, getRulesetRepository(this.env));
	}
}

export default {
	fetch(request: Request, env: StatsigEnv): Promise<Response> {
		return handleAdminRequest(request, env, getRulesetRepository(env));
	},
} satisfies ExportedHandler<StatsigEnv>;
