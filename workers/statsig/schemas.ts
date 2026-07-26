import { z } from 'zod';

const statsigPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

export const canonicalUserSchema = z.object({
	userID: z.string().min(1),
	email: z.string().email().optional(),
	customIDs: z.record(z.string(), z.string()).optional(),
	custom: z.record(z.string(), statsigPrimitiveSchema).optional(),
	statsigEnvironment: z.object({ tier: z.string().min(1) }),
});

export type CanonicalUser = z.infer<typeof canonicalUserSchema>;

export const internalUserHeaderSchema = z.string().transform((value, context) => {
	try {
		return canonicalUserSchema.parse(JSON.parse(value));
	} catch (error) {
		context.addIssue({
			code: 'custom',
			message: error instanceof Error ? error.message : 'Invalid user header',
		});
		return z.NEVER;
	}
});

export const statsigConditionSchema = z.object({
	type: z.string(),
	targetValue: z.unknown(),
	operator: z.string().nullable(),
	field: z.string().nullable(),
	additionalValues: z.record(z.string(), z.unknown()).nullable().optional(),
	idType: z.string().default('userID'),
});

export const statsigRuleSchema = z.object({
	name: z.string().default(''),
	passPercentage: z.number().min(0).max(100).default(100),
	conditions: z.array(statsigConditionSchema).default([]),
	returnValue: z.unknown(),
	id: z.string(),
	salt: z.string().default(''),
	idType: z.string().default('userID'),
	configDelegate: z.string().nullable().default(null),
	isExperimentGroup: z.boolean().optional(),
	groupName: z.string().optional(),
});

export const statsigSpecSchema = z.object({
	name: z.string(),
	type: z.string(),
	salt: z.string().default(''),
	defaultValue: z.unknown(),
	enabled: z.boolean().default(true),
	idType: z.string().default('userID'),
	rules: z.array(statsigRuleSchema).default([]),
	entity: z.string().default(''),
	explicitParameters: z.array(z.string()).nullable().default(null),
	hasSharedParams: z.boolean().default(false),
	isActive: z.boolean().optional(),
	targetAppIDs: z.array(z.string()).optional(),
	version: z.number().optional(),
});

export const statsigRulesetSchema = z.object({
	feature_gates: z.array(statsigSpecSchema).default([]),
	dynamic_configs: z.array(statsigSpecSchema).default([]),
	layer_configs: z.array(statsigSpecSchema).default([]),
	segments: z.array(statsigSpecSchema).default([]),
	time: z.number(),
	has_updates: z.boolean().default(true),
	sdkInfo: z.record(z.string(), z.string()).optional(),
	default_environment: z.string().optional(),
	app_id: z.string().optional(),
});

export type StatsigRuleset = z.infer<typeof statsigRulesetSchema>;
export type StatsigSpec = z.infer<typeof statsigSpecSchema>;
export type StatsigRule = z.infer<typeof statsigRuleSchema>;
export type StatsigCondition = z.infer<typeof statsigConditionSchema>;

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
	user: canonicalUserSchema,
});

export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;
