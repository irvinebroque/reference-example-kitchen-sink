import { z } from 'zod';
import type { TargetingUser } from '../../shared/statsig-contract';
import type {
	CompiledCondition,
	CompiledPredicate,
	CompiledRule,
	CompiledRuleset,
	CompiledSpec,
	ConditionValue,
	UserFieldCondition,
} from './ruleset-model';
import type {
	JsonValue,
	StatsigConditionDocument,
	StatsigRuleDocument,
	StatsigRulesetDocument,
	StatsigSpecDocument,
} from './ruleset-schema';

type OperatorCompiler = (target: JsonValue) => CompiledPredicate;
type ConditionCompiler = (condition: StatsigConditionDocument) => CompiledCondition;

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const scalarListSchema = z.union([scalarSchema, z.array(scalarSchema)]).transform((value) => (Array.isArray(value) ? value : [value]));
const numericTargetSchema = z.union([z.number(), z.string()]).transform(Number);
const stringTargetSchema = z.string();
const stringListSchema = z.union([z.string(), z.array(z.string())]).transform((value) => (Array.isArray(value) ? value : [value]));

const encoder = new TextEncoder();

function compareVersions(left: string, right: string): number {
	const leftParts = left.split('.').map(Number);
	const rightParts = right.split('.').map(Number);
	for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

function validDate(value: ConditionValue): number | undefined {
	const timestamp = new Date(String(value)).getTime();
	return Number.isNaN(timestamp) ? undefined : timestamp;
}

function equalityPredicate(target: JsonValue): CompiledPredicate {
	const targets = scalarListSchema.parse(target);
	return (actual) => targets.some((candidate) => actual === candidate);
}

function inequalityPredicate(target: JsonValue): CompiledPredicate {
	const targets = scalarListSchema.parse(target);
	return (actual) => targets.every((candidate) => actual !== candidate);
}

function numericPredicate(target: JsonValue, compare: (actual: number, expected: number) => boolean): CompiledPredicate {
	const expected = numericTargetSchema.parse(target);
	return (actual) => compare(Number(actual), expected);
}

function stringListPredicate(
	target: JsonValue,
	compare: (actual: string, expected: string) => boolean,
	mode: 'some' | 'every' = 'some',
): CompiledPredicate {
	const expected = stringListSchema.parse(target);
	return (actual) => expected[mode]((candidate) => compare(String(actual ?? ''), candidate));
}

function versionPredicate(target: JsonValue, compare: (order: number) => boolean): CompiledPredicate {
	const expected = stringTargetSchema.parse(target);
	return (actual) => compare(compareVersions(String(actual ?? ''), expected));
}

function datePredicate(target: JsonValue, compare: (actual: number, expected: number) => boolean): CompiledPredicate {
	const expected = validDate(stringTargetSchema.parse(target));
	if (expected === undefined) throw new Error('Invalid date target');
	return (actual) => {
		const timestamp = validDate(actual);
		return timestamp !== undefined && compare(timestamp, expected);
	};
}

export const operatorRegistry = {
	eq: equalityPredicate,
	any: equalityPredicate,
	neq: inequalityPredicate,
	none: inequalityPredicate,
	gt: (target) => numericPredicate(target, (actual, expected) => actual > expected),
	gte: (target) => numericPredicate(target, (actual, expected) => actual >= expected),
	lt: (target) => numericPredicate(target, (actual, expected) => actual < expected),
	lte: (target) => numericPredicate(target, (actual, expected) => actual <= expected),
	contains_any: (target) => stringListPredicate(target, (actual, expected) => actual.includes(expected)),
	contains_none: (target) => stringListPredicate(target, (actual, expected) => !actual.includes(expected), 'every'),
	str_starts_with_any: (target) => stringListPredicate(target, (actual, expected) => actual.startsWith(expected)),
	str_ends_with_any: (target) => stringListPredicate(target, (actual, expected) => actual.endsWith(expected)),
	str_matches: (target) =>
		stringListPredicate(target, (actual, expected) => {
			try {
				return new RegExp(expected).test(actual);
			} catch {
				return false;
			}
		}),
	regex: (target) =>
		stringListPredicate(target, (actual, expected) => {
			try {
				return new RegExp(expected).test(actual);
			} catch {
				return false;
			}
		}),
	version_gt: (target) => versionPredicate(target, (order) => order > 0),
	version_gte: (target) => versionPredicate(target, (order) => order >= 0),
	version_lt: (target) => versionPredicate(target, (order) => order < 0),
	version_lte: (target) => versionPredicate(target, (order) => order <= 0),
	before: (target) => datePredicate(target, (actual, expected) => actual < expected),
	after: (target) => datePredicate(target, (actual, expected) => actual > expected),
	on: (target) => {
		const expected = stringTargetSchema.parse(target);
		return (actual) => {
			const timestamp = validDate(actual);
			return timestamp !== undefined && new Date(timestamp).toISOString().slice(0, 10) === expected;
		};
	},
} satisfies Record<string, OperatorCompiler>;

export type SupportedOperator = keyof typeof operatorRegistry;

const operatorLookup: Readonly<Record<string, OperatorCompiler>> = operatorRegistry;

function compilePredicate(condition: StatsigConditionDocument): CompiledPredicate | undefined {
	const compiler = operatorLookup[condition.operator ?? 'eq'];
	if (!compiler) return undefined;
	try {
		return compiler(condition.targetValue);
	} catch {
		return undefined;
	}
}

function getUnitId(user: TargetingUser, idType: string): string | undefined {
	return idType === 'userID' ? user.userID : user.customIDs?.[idType];
}

function getField(user: TargetingUser, field: string): ConditionValue {
	if (field === 'userID') return user.userID;
	if (field === 'email') return user.email;
	if (field === 'environment' || field === 'tier') return user.statsigEnvironment.tier;
	if (field.startsWith('custom.')) return user.custom?.[field.slice('custom.'.length)];
	return user.custom?.[field] ?? user.customIDs?.[field];
}

async function rolloutBucket(input: string): Promise<number> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
	const bytes = new Uint8Array(digest);
	const value = ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
	return (value >>> 0) % 10_000;
}

function unsupported(externalType: string): CompiledCondition {
	return {
		kind: 'unsupported',
		externalType,
		async test() {
			return false;
		},
	};
}

function withPredicate(
	condition: StatsigConditionDocument,
	compile: (predicate: CompiledPredicate) => CompiledCondition,
): CompiledCondition {
	const predicate = compilePredicate(condition);
	return predicate ? compile(predicate) : unsupported(`${condition.type}:${condition.operator ?? 'eq'}`);
}

function compileUserField(condition: StatsigConditionDocument): CompiledCondition {
	const field = condition.field;
	if (!field) return unsupported(condition.type);
	return withPredicate(condition, (predicate): UserFieldCondition => ({
		kind: 'userField',
		field,
		predicate,
		async test(_runtime, context) {
			return predicate(getField(context.user, field));
		},
	}));
}

export const conditionRegistry = {
	public: (): CompiledCondition => ({
		kind: 'public',
		async test() {
			return true;
		},
	}),
	unit_id: (condition): CompiledCondition => {
		const idType = condition.idType;
		return withPredicate(condition, (predicate) => ({
			kind: 'unitId',
			idType,
			predicate,
			async test(_runtime, context) {
				return predicate(getUnitId(context.user, idType));
			},
		}));
	},
	user_field: compileUserField,
	custom_field: compileUserField,
	environment_field: compileUserField,
	current_time: (condition): CompiledCondition =>
		withPredicate(condition, (predicate) => ({
			kind: 'currentTime',
			predicate,
			async test(_runtime, context) {
				return predicate(context.now().toISOString());
			},
		})),
	target_app: (condition): CompiledCondition =>
		withPredicate(condition, (predicate) => ({
			kind: 'targetApplication',
			predicate,
			async test(_runtime, context) {
				return predicate(context.applicationId);
			},
		})),
	segment: (condition): CompiledCondition => {
		const parsed = z.string().min(1).safeParse(condition.targetValue);
		if (!parsed.success) return unsupported(condition.type);
		return {
			kind: 'segment',
			segmentName: parsed.data,
			test(runtime, context, ancestry) {
				return runtime.evaluateSegment(parsed.data, context, ancestry);
			},
		};
	},
	user_bucket: (condition): CompiledCondition => {
		const idType = condition.idType;
		const field = condition.field ?? '';
		const bucketSalt = String(condition.targetValue);
		return withPredicate(condition, (predicate) => ({
			kind: 'userBucket',
			idType,
			field,
			bucketSalt,
			predicate,
			async test(_runtime, context) {
				const unitId = getUnitId(context.user, idType);
				if (!unitId) return false;
				const bucket = await rolloutBucket(`${unitId}:${field}:${bucketSalt}`);
				return predicate(bucket / 100);
			},
		}));
	},
} satisfies Record<string, ConditionCompiler>;

export type SupportedConditionType = keyof typeof conditionRegistry;

const conditionLookup: Readonly<Record<string, ConditionCompiler>> = conditionRegistry;

function compileCondition(condition: StatsigConditionDocument): CompiledCondition {
	return conditionLookup[condition.type]?.(condition) ?? unsupported(condition.type);
}

function compileRule(rule: StatsigRuleDocument): CompiledRule {
	return {
		name: rule.name,
		passPercentage: rule.passPercentage,
		conditions: rule.conditions.map(compileCondition),
		returnValue: rule.returnValue,
		id: rule.id,
		salt: rule.salt,
		idType: rule.idType,
		configDelegate: rule.configDelegate,
		isExperimentGroup: rule.isExperimentGroup,
		groupName: rule.groupName,
	};
}

function compileSpec(spec: StatsigSpecDocument): CompiledSpec {
	return {
		name: spec.name,
		type: spec.type,
		salt: spec.salt,
		defaultValue: spec.defaultValue,
		enabled: spec.enabled,
		idType: spec.idType,
		rules: spec.rules.map(compileRule),
		entity: spec.entity,
		explicitParameters: spec.explicitParameters,
		hasSharedParams: spec.hasSharedParams,
		isActive: spec.isActive,
		targetAppIDs: spec.targetAppIDs,
		version: spec.version,
	};
}

export function compileRuleset(document: StatsigRulesetDocument): CompiledRuleset {
	const segments = document.segments.map(compileSpec);
	return {
		featureGates: document.feature_gates.map(compileSpec),
		dynamicConfigs: document.dynamic_configs.map(compileSpec),
		layerConfigs: document.layer_configs.map(compileSpec),
		segments: new Map(segments.map((segment) => [segment.name, segment])),
		time: document.time,
		hasUpdates: document.has_updates,
		sdkInfo: document.sdkInfo,
		defaultEnvironment: document.default_environment,
		applicationId: document.app_id,
	};
}

export function supportedCompatibilityEnvelope(): { conditionTypes: SupportedConditionType[]; operators: SupportedOperator[] } {
	return {
		conditionTypes: Object.keys(conditionRegistry) as SupportedConditionType[],
		operators: Object.keys(operatorRegistry) as SupportedOperator[],
	};
}
