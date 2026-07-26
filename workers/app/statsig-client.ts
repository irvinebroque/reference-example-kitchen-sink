import {
	evaluatorServiceResponseSchema,
	targetingUserSchema,
	type StatsigAssignment,
} from '../../shared/statsig-contract';
import { canonicalizeUser, createUserCacheKey } from '../../shared/user-cache-key';

interface StatsigConfig {
	applicationId: string;
	environment: string;
	hmacSecret: string;
	service: Service;
}

export async function loadStatsigAssignment(
	config: StatsigConfig,
	user: { id: string; email?: string | null },
): Promise<StatsigAssignment> {
	const targetingUser = targetingUserSchema.parse({
		userID: user.id,
		email: user.email?.trim().toLowerCase() || undefined,
		customIDs: {
			applicationID: config.applicationId,
		},
		custom: {
			applicationId: config.applicationId,
			tenantId: 'reference-tenant',
		},
		statsigEnvironment: {
			tier: config.environment,
		},
	});
	const cacheKey = await createUserCacheKey(targetingUser, config.hmacSecret);
	const request = new Request(`https://statsig.internal/v1/bootstrap/${encodeURIComponent(config.applicationId)}/${cacheKey}`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'X-Statsig-User': canonicalizeUser(targetingUser),
		},
	});
	const response = await config.service.fetch(request);
	if (!response.ok) {
		throw new Error(`Statsig evaluator returned ${response.status}`);
	}
	const parsed = evaluatorServiceResponseSchema.parse(await response.json());
	return {
		bootstrap: parsed.bootstrap,
		diagnostics: {
			...parsed.diagnostics,
			cacheStatus: response.headers.get('cf-cache-status') ?? 'LOCAL/UNKNOWN',
			userKeyPrefix: cacheKey.slice(0, 11),
		},
	};
}
