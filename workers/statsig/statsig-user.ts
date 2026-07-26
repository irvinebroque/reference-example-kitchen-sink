import { z } from 'zod';
import type { FeatureSubject } from '../../shared/feature-contract';

const statsigPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

export const targetingUserSchema = z.object({
	userID: z.string().min(1),
	email: z.string().email().optional(),
	customIDs: z.record(z.string(), z.string()).optional(),
	custom: z.record(z.string(), statsigPrimitiveSchema).optional(),
	statsigEnvironment: z.object({ tier: z.string().min(1) }),
});

export type TargetingUser = z.infer<typeof targetingUserSchema>;

export function createStatsigUser(subject: FeatureSubject, env: StatsigEnv): TargetingUser {
	return targetingUserSchema.parse({
		userID: subject.id,
		email: subject.email,
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

export function parseTargetingUserHeader(value: string): TargetingUser {
	return targetingUserSchema.parse(JSON.parse(value));
}
