import {
	evaluatorServiceResponseSchema,
	targetingUserSchema,
	type StatsigAssignment,
	type TargetingUser,
} from '../shared/statsig-contract';
import { canonicalizeUser, createUserCacheKey } from '../shared/user-cache-key';

export type { StatsigAssignment } from '../shared/statsig-contract';

interface StatsigServiceConfig {
	applicationId: string;
	environment: string;
	hmacSecret: string;
	service: Service;
}

export class StatsigService {
	constructor(private readonly config: StatsigServiceConfig) {}

	createTargetingUser(user: { id: string; email?: string | null }): TargetingUser {
		return targetingUserSchema.parse({
			userID: user.id,
			email: user.email?.trim().toLowerCase() || undefined,
			customIDs: {
				applicationID: this.config.applicationId,
			},
			custom: {
				applicationId: this.config.applicationId,
				tenantId: 'reference-tenant',
			},
			statsigEnvironment: {
				tier: this.config.environment,
			},
		});
	}

	async loadAssignment(user: { id: string; email?: string | null }): Promise<StatsigAssignment> {
		const targetingUser = this.createTargetingUser(user);
		const cacheKey = await createUserCacheKey(targetingUser, this.config.hmacSecret);
		const request = new Request(`https://statsig.internal/v1/bootstrap/${encodeURIComponent(this.config.applicationId)}/${cacheKey}`, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				'X-Statsig-User': canonicalizeUser(targetingUser),
			},
		});
		const response = await this.config.service.fetch(request);
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
}
