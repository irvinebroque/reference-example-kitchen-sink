import type { FeatureSubject } from '../../shared/feature-contract';
import { targetingUserSchema, type TargetingUser } from './targeting-user-contract';

export type { TargetingUser } from './targeting-user-contract';

export function createStatsigUser(subject: FeatureSubject, env: StatsigEnv): TargetingUser {
	return targetingUserSchema.parse({
		userID: subject.id,
		privateAttributes: subject.email ? { email: subject.email } : undefined,
		customIDs: {
			applicationID: env.APP_ID,
		},
		custom: {
			applicationId: env.APP_ID,
			tenantId: env.TENANT_ID,
		},
		statsigEnvironment: {
			tier: env.APP_ENVIRONMENT,
		},
	});
}
