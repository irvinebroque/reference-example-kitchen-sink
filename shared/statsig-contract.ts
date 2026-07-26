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

export const statsigUserSchema = targetingUserSchema.omit({ statsigEnvironment: true });
export type StatsigUser = z.infer<typeof statsigUserSchema>;

export function toStatsigUser(user: TargetingUser): StatsigUser {
	const { statsigEnvironment: _environment, ...statsigUser } = user;
	return statsigUser;
}

const secondaryExposureSchema = z.object({
	gate: z.string(),
	gateValue: z.string(),
	ruleID: z.string(),
});

const evaluationBaseSchema = z.object({
	id_type: z.string(),
	name: z.string(),
	rule_id: z.string(),
	secondary_exposures: z.array(z.union([secondaryExposureSchema, z.string()])),
	version: z.string().optional(),
});

export const bootstrapResponseSchema = z.object({
	feature_gates: z.record(z.string(), evaluationBaseSchema.extend({ value: z.boolean() })),
	dynamic_configs: z.record(
		z.string(),
		evaluationBaseSchema.extend({
			value: z.record(z.string(), z.unknown()),
			group: z.string(),
			group_name: z.string().optional(),
			is_device_based: z.boolean(),
			is_experiment_active: z.boolean().optional(),
			is_user_in_experiment: z.boolean().optional(),
			passed: z.boolean().optional(),
			is_in_layer: z.boolean().optional(),
			explicit_parameters: z.array(z.string()).optional(),
		}),
	),
	layer_configs: z.record(
		z.string(),
		evaluationBaseSchema.extend({
			value: z.record(z.string(), z.unknown()),
			group: z.string(),
			group_name: z.string().optional(),
			is_device_based: z.boolean(),
			allocated_experiment_name: z.string(),
			explicit_parameters: z.array(z.string()),
			undelegated_secondary_exposures: z.array(z.union([secondaryExposureSchema, z.string()])).optional(),
			parameter_rule_ids: z.record(z.string(), z.string()).optional(),
		}),
	),
	has_updates: z.literal(true),
	time: z.number(),
	generator: z.string(),
	sdkInfo: z.record(z.string(), z.string()),
	evaluated_keys: z.record(z.string(), z.unknown()),
	hash_used: z.literal('none'),
	user: statsigUserSchema,
});

export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;

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
