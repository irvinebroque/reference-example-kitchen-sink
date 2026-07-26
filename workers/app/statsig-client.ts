import { z } from 'zod';
import { bootstrapResponseSchema, canonicalUserSchema, type BootstrapResponse, type CanonicalUser } from '../statsig/schemas';
import { canonicalizeUser, createUserCacheKey } from '../statsig/user-key';

const serviceResponseSchema = z.object({
	bootstrap: bootstrapResponseSchema,
	diagnostics: z.object({
		evaluatorVersion: z.string(),
		rulesetGeneration: z.string(),
		rulesetStale: z.boolean(),
		evaluatorDurationMs: z.number(),
		payloadBytes: z.number(),
	}),
});

export interface StatsigDiagnostics {
	cacheStatus: string;
	evaluatorVersion: string;
	rulesetGeneration: string;
	rulesetStale: boolean;
	evaluatorDurationMs: number;
	payloadBytes: number;
	userKeyPrefix: string;
}

export interface StatsigAssignment {
	bootstrap: BootstrapResponse;
	diagnostics: StatsigDiagnostics;
}

export function createCanonicalUser(user: { id: string; email?: string | null }, env: Env): CanonicalUser {
	return canonicalUserSchema.parse({
		userID: user.id,
		email: user.email?.trim().toLowerCase() || undefined,
		customIDs: {
			applicationID: env.APP_ID,
		},
		custom: {
			applicationId: env.APP_ID,
			tenantId: 'reference-tenant',
		},
		statsigEnvironment: {
			tier: env.APP_ENVIRONMENT,
		},
	});
}

export async function loadStatsigAssignment(user: CanonicalUser, env: Env): Promise<StatsigAssignment> {
	const cacheKey = await createUserCacheKey(user, env.USER_CACHE_HMAC_SECRET);
	const request = new Request(`https://statsig.internal/v1/bootstrap/${encodeURIComponent(env.APP_ID)}/${cacheKey}`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'X-Statsig-User': canonicalizeUser(user),
		},
	});
	const response = await env.STATSIG_SERVICE.fetch(request);
	if (!response.ok) {
		throw new Error(`Statsig evaluator returned ${response.status}`);
	}
	const parsed = serviceResponseSchema.parse(await response.json());
	return {
		bootstrap: parsed.bootstrap,
		diagnostics: {
			...parsed.diagnostics,
			cacheStatus: response.headers.get('cf-cache-status') ?? 'LOCAL/UNKNOWN',
			userKeyPrefix: cacheKey.slice(0, 11),
		},
	};
}
