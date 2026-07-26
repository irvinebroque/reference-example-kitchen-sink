import { timingSafeEqual } from 'node:crypto';
import { supportedCompatibilityEnvelope } from './rule-evaluator';
import { noStoreJson } from './responses';
import type { RulesetRepository } from './ruleset-cache';

const encoder = new TextEncoder();

function authorized(request: Request, secret: string): boolean {
	const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '');
	if (!supplied) return false;
	const suppliedBytes = encoder.encode(supplied);
	const expectedBytes = encoder.encode(secret);
	return suppliedBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(suppliedBytes, expectedBytes);
}

export async function handleAdminRequest(request: Request, env: StatsigEnv, repository: RulesetRepository): Promise<Response> {
	const pathname = new URL(request.url).pathname;
	if (pathname === '/health') {
		return noStoreJson({
			ok: true,
			entrypoint: 'admin',
			evaluatorVersion: env.EVALUATOR_VERSION,
			volatileCache: 'workerd-memory-cache',
			memoryCacheConfiguration: 'unsafe-volatile-cache-binding',
		});
	}
	if (pathname === '/diagnostics/compatibility') {
		return noStoreJson(supportedCompatibilityEnvelope());
	}
	if (pathname === '/admin/refresh' && request.method === 'POST') {
		if (!authorized(request, env.REFRESH_SECRET)) {
			return noStoreJson({ error: 'unauthorized' }, { status: 401 });
		}
		const snapshot = await repository.get(true);
		return noStoreJson({
			ok: true,
			rulesetGeneration: snapshot.generation,
			stale: snapshot.stale,
		});
	}
	return noStoreJson({ error: 'not_found' }, { status: 404 });
}

export async function refreshRuleset(repository: RulesetRepository): Promise<void> {
	const snapshot = await repository.get(true);
	console.log(
		JSON.stringify({
			event: 'statsig_ruleset_refresh',
			rulesetGeneration: snapshot.generation,
			stale: snapshot.stale,
		}),
	);
}
