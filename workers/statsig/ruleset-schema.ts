import { z } from 'zod';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

export const statsigConditionSchema = z.object({
	type: z.string(),
	targetValue: jsonValueSchema,
	operator: z.string().nullable(),
	field: z.string().nullable(),
	additionalValues: z.record(z.string(), jsonValueSchema).nullable().optional(),
	idType: z.string().default('userID'),
});

export const statsigRuleSchema = z.object({
	name: z.string().default(''),
	passPercentage: z.number().min(0).max(100).default(100),
	conditions: z.array(statsigConditionSchema).default([]),
	returnValue: jsonValueSchema,
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
	defaultValue: jsonValueSchema,
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

export type StatsigRulesetDocument = z.infer<typeof statsigRulesetSchema>;
export type StatsigSpecDocument = z.infer<typeof statsigSpecSchema>;
export type StatsigRuleDocument = z.infer<typeof statsigRuleSchema>;
export type StatsigConditionDocument = z.infer<typeof statsigConditionSchema>;
