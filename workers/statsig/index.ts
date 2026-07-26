import { timingSafeEqual } from 'node:crypto';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { evaluateRuleset, supportedCompatibilityEnvelope } from './evaluator';
import { internalUserHeaderSchema, bootstrapResponseSchema, type CanonicalUser } from './schemas';
import { IsolateVolatileValueCache, RulesetRepository, StatsigRulesetSource } from './ruleset-cache';
import { anonymousKeyPrefix, verifyUserCacheKey } from './user-key';

const NO_STORE_HEADERS = {
	'Cache-Control': 'private, no-store',
	'Content-Type': 'application/json; charset=utf-8',
};

let repository: RulesetRepository | undefined;

function numberSetting(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRepository(env: StatsigEnv): RulesetRepository {
	repository ??= new RulesetRepository(
		new StatsigRulesetSource(env.STATSIG_SERVER_SECRET),
		new IsolateVolatileValueCache(),
		numberSetting(env.RULESET_TTL_SECONDS, 300),
	);
	return repository;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return Response.json(body, {
		...init,
		headers: {
			...NO_STORE_HEADERS,
			...Object.fromEntries(new Headers(init.headers)),
		},
	});
}

function parseEvaluationPath(pathname: string): { applicationId: string; cacheKey: string } | undefined {
	const match = /^\/v1\/bootstrap\/([^/]+)\/(v1_[a-f0-9]{64})$/.exec(pathname);
	if (!match) return undefined;
	return {
		applicationId: decodeURIComponent(match[1] ?? ''),
		cacheKey: match[2] ?? '',
	};
}

async function parseAndVerifyUser(
	request: Request,
	applicationId: string,
	cacheKey: string,
	env: StatsigEnv,
): Promise<CanonicalUser | Response> {
	const header = request.headers.get('x-statsig-user');
	if (!header) {
		return jsonResponse({ error: 'missing_user' }, { status: 400 });
	}
	const parsed = internalUserHeaderSchema.safeParse(header);
	if (!parsed.success) {
		return jsonResponse({ error: 'invalid_user' }, { status: 400 });
	}
	if (parsed.data.custom?.applicationId !== applicationId) {
		return jsonResponse({ error: 'application_mismatch' }, { status: 400 });
	}
	if (!(await verifyUserCacheKey(parsed.data, env.USER_CACHE_HMAC_SECRET, cacheKey))) {
		return jsonResponse({ error: 'invalid_cache_key' }, { status: 403 });
	}
	return parsed.data;
}

export class EvaluationEntrypoint extends WorkerEntrypoint<StatsigEnv> {
	async fetch(request: Request): Promise<Response> {
		const startedAt = performance.now();
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return jsonResponse({ error: 'method_not_allowed' }, { status: 405 });
		}
		const route = parseEvaluationPath(new URL(request.url).pathname);
		if (!route) {
			return jsonResponse({ error: 'not_found' }, { status: 404 });
		}
		const user = await parseAndVerifyUser(request, route.applicationId, route.cacheKey, this.env);
		if (user instanceof Response) return user;

		try {
			const snapshot = await getRepository(this.env).get();
			const bootstrap = bootstrapResponseSchema.parse(await evaluateRuleset(snapshot.ruleset, user, route.applicationId));
			const body = JSON.stringify({
				bootstrap,
				diagnostics: {
					evaluatorVersion: this.env.EVALUATOR_VERSION,
					rulesetGeneration: snapshot.generation,
					rulesetStale: snapshot.stale,
					evaluatorDurationMs: Math.round(performance.now() - startedAt),
					payloadBytes: new TextEncoder().encode(JSON.stringify(bootstrap)).byteLength,
				},
			});
			console.log(
				JSON.stringify({
					event: 'statsig_evaluation',
					applicationId: route.applicationId,
					userKeyPrefix: anonymousKeyPrefix(route.cacheKey),
					rulesetGeneration: snapshot.generation,
					payloadBytes: new TextEncoder().encode(body).byteLength,
					durationMs: Math.round(performance.now() - startedAt),
				}),
			);
			return new Response(request.method === 'HEAD' ? null : body, {
				headers: {
					'Cache-Control': `public, max-age=${numberSetting(this.env.BOOTSTRAP_TTL_SECONDS, 60)}, stale-while-revalidate=${numberSetting(this.env.BOOTSTRAP_STALE_SECONDS, 300)}`,
					'Cache-Tag': `statsig-app-${route.applicationId}`,
					'Content-Type': 'application/json; charset=utf-8',
					'X-Evaluator-Version': this.env.EVALUATOR_VERSION,
					'X-Ruleset-Generation': snapshot.generation,
				},
			});
		} catch (error) {
			console.error(
				JSON.stringify({
					event: 'statsig_evaluation_error',
					applicationId: route.applicationId,
					userKeyPrefix: anonymousKeyPrefix(route.cacheKey),
					message: error instanceof Error ? error.message : 'Unknown error',
				}),
			);
			return jsonResponse({ error: 'evaluation_failed' }, { status: 503 });
		}
	}
}

export default {
	async fetch(request: Request, env: StatsigEnv): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/health') {
			return jsonResponse({
				ok: true,
				entrypoint: 'admin',
				evaluatorVersion: env.EVALUATOR_VERSION,
				volatileCache: 'isolate-fallback',
				memoryCachePrerequisite: 'unsupported-by-wrangler-4.114.0',
			});
		}
		if (url.pathname === '/diagnostics/compatibility') {
			return jsonResponse(supportedCompatibilityEnvelope());
		}
		if (url.pathname === '/admin/refresh' && request.method === 'POST') {
			const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '');
			const suppliedBytes = new TextEncoder().encode(supplied ?? '');
			const expectedBytes = new TextEncoder().encode(env.REFRESH_SECRET);
			if (!supplied || suppliedBytes.byteLength !== expectedBytes.byteLength || !timingSafeEqual(suppliedBytes, expectedBytes)) {
				return jsonResponse({ error: 'unauthorized' }, { status: 401 });
			}
			const snapshot = await getRepository(env).get(true);
			return jsonResponse({
				ok: true,
				rulesetGeneration: snapshot.generation,
				stale: snapshot.stale,
			});
		}
		return jsonResponse({ error: 'not_found' }, { status: 404 });
	},

	async scheduled(_controller: ScheduledController, env: StatsigEnv, _ctx: ExecutionContext): Promise<void> {
		const snapshot = await getRepository(env).get(true);
		console.log(
			JSON.stringify({
				event: 'statsig_ruleset_refresh',
				rulesetGeneration: snapshot.generation,
				stale: snapshot.stale,
			}),
		);
	},
} satisfies ExportedHandler<StatsigEnv>;
