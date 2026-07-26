import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleAdminRequest } from './admin-handler';
import { handleEvaluationRequest } from './evaluation-handler';
import { getRulesetRepository } from './runtime';

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
