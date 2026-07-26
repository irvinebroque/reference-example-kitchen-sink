import type { StatsigServerlessClient } from '@statsig/serverless-client';
import { z } from 'zod';

const statsigPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

export const targetingUserSchema = z.object({
	userID: z.string().min(1),
	email: z.string().email().optional(),
	customIDs: z.record(z.string(), z.string()).optional(),
	custom: z.record(z.string(), statsigPrimitiveSchema).optional(),
	statsigEnvironment: z.object({ tier: z.string().min(1) }),
});

export type TargetingUser = z.infer<typeof targetingUserSchema>;

export const statsigUserSchema = targetingUserSchema.omit({ statsigEnvironment: true }).passthrough();
export type StatsigUser = z.infer<typeof statsigUserSchema>;

export type BootstrapResponse = NonNullable<ReturnType<StatsigServerlessClient['getClientInitializeResponse']>>;

const consumedBootstrapFieldsSchema = z
	.object({
		feature_gates: z.record(z.string(), z.object({ value: z.boolean() }).passthrough()),
		user: statsigUserSchema,
	})
	.passthrough();

const bootstrapResponseSchema = z.custom<BootstrapResponse>(
	(value): value is BootstrapResponse => consumedBootstrapFieldsSchema.safeParse(value).success,
);

export const evaluatorServiceResponseSchema = z.object({
	bootstrap: bootstrapResponseSchema,
	diagnostics: z.object({
		evaluatorVersion: z.string(),
		rulesetGeneration: z.string(),
		rulesetStale: z.boolean(),
		evaluatorDurationMs: z.number(),
		payloadBytes: z.number(),
	}),
});

export type EvaluatorServiceResponse = z.infer<typeof evaluatorServiceResponseSchema>;

export type StatsigDiagnostics = EvaluatorServiceResponse['diagnostics'] & {
	cacheStatus: string;
	userKeyPrefix: string;
};

export interface StatsigAssignment {
	bootstrap: BootstrapResponse;
	diagnostics: StatsigDiagnostics;
}

export interface ReferenceBootstrap {
	clientKey: string;
	user: StatsigUser;
	bootstrap: BootstrapResponse;
}

export function parseTargetingUserHeader(value: string): TargetingUser {
	return targetingUserSchema.parse(JSON.parse(value));
}
