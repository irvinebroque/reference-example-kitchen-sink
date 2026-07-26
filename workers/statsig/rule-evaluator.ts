import type { TargetingUser } from '../shared/statsig-contract';
import type { StatsigCondition, StatsigRule, StatsigRuleset, StatsigSpec } from './ruleset-schema';

export interface EvaluationResult {
	matched: boolean;
	rule: StatsigRule | undefined;
	value: unknown;
}

export interface EvaluationContext {
	ruleset: StatsigRuleset;
	user: TargetingUser;
	applicationId: string;
	segmentStack: Set<string>;
}

const encoder = new TextEncoder();

function getUnitId(user: TargetingUser, idType: string): string | undefined {
	if (idType === 'userID') {
		return user.userID;
	}
	return user.customIDs?.[idType];
}

function getField(user: TargetingUser, field: string | null): unknown {
	if (!field) return undefined;
	if (field === 'userID') return user.userID;
	if (field === 'email') return user.email;
	if (field === 'environment' || field === 'tier') {
		return user.statsigEnvironment.tier;
	}
	if (field.startsWith('custom.')) {
		return user.custom?.[field.slice('custom.'.length)];
	}
	return user.custom?.[field] ?? user.customIDs?.[field];
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [value];
}

function compareVersions(left: string, right: string): number {
	const leftParts = left.split('.').map(Number);
	const rightParts = right.split('.').map(Number);
	for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

function compareCondition(actual: unknown, operator: string | null, target: unknown): boolean {
	const targets = asArray(target);
	switch (operator ?? 'eq') {
		case 'eq':
		case 'any':
			return targets.some((candidate) => actual === candidate);
		case 'neq':
		case 'none':
			return targets.every((candidate) => actual !== candidate);
		case 'gt':
			return Number(actual) > Number(target);
		case 'gte':
			return Number(actual) >= Number(target);
		case 'lt':
			return Number(actual) < Number(target);
		case 'lte':
			return Number(actual) <= Number(target);
		case 'contains_any':
			return targets.some((candidate) => String(actual ?? '').includes(String(candidate)));
		case 'contains_none':
			return targets.every((candidate) => !String(actual ?? '').includes(String(candidate)));
		case 'str_starts_with_any':
			return targets.some((candidate) => String(actual ?? '').startsWith(String(candidate)));
		case 'str_ends_with_any':
			return targets.some((candidate) => String(actual ?? '').endsWith(String(candidate)));
		case 'str_matches':
		case 'regex':
			return targets.some((candidate) => {
				try {
					return new RegExp(String(candidate)).test(String(actual ?? ''));
				} catch {
					return false;
				}
			});
		case 'version_gt':
			return compareVersions(String(actual ?? ''), String(target)) > 0;
		case 'version_gte':
			return compareVersions(String(actual ?? ''), String(target)) >= 0;
		case 'version_lt':
			return compareVersions(String(actual ?? ''), String(target)) < 0;
		case 'version_lte':
			return compareVersions(String(actual ?? ''), String(target)) <= 0;
		case 'before':
			return new Date(String(actual)).getTime() < new Date(String(target)).getTime();
		case 'after':
			return new Date(String(actual)).getTime() > new Date(String(target)).getTime();
		case 'on':
			return new Date(String(actual)).toISOString().slice(0, 10) === String(target);
		default:
			return false;
	}
}

async function rolloutBucket(input: string): Promise<number> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
	const bytes = new Uint8Array(digest);
	const value = ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
	return (value >>> 0) % 10_000;
}

async function evaluateSegment(name: string, context: EvaluationContext): Promise<boolean> {
	if (context.segmentStack.has(name)) return false;
	const segment = context.ruleset.segments.find((candidate) => candidate.name === name);
	if (!segment) return false;
	context.segmentStack.add(name);
	try {
		return (await evaluateSpec(segment, context)).matched;
	} finally {
		context.segmentStack.delete(name);
	}
}

async function evaluateCondition(condition: StatsigCondition, context: EvaluationContext): Promise<boolean> {
	switch (condition.type) {
		case 'public':
			return true;
		case 'unit_id':
			return compareCondition(getUnitId(context.user, condition.idType), condition.operator, condition.targetValue);
		case 'user_field':
		case 'custom_field':
		case 'environment_field':
			return compareCondition(getField(context.user, condition.field), condition.operator, condition.targetValue);
		case 'current_time':
			return compareCondition(new Date().toISOString(), condition.operator, condition.targetValue);
		case 'target_app':
			return compareCondition(context.applicationId, condition.operator, condition.targetValue);
		case 'segment':
			return evaluateSegment(String(condition.targetValue), context);
		case 'user_bucket': {
			const unitId = getUnitId(context.user, condition.idType);
			if (!unitId) return false;
			const bucket = await rolloutBucket(`${unitId}:${condition.field ?? ''}:${String(condition.targetValue)}`);
			return compareCondition(bucket / 100, condition.operator, condition.targetValue);
		}
		default:
			return false;
	}
}

export async function evaluateSpec(spec: StatsigSpec, context: EvaluationContext): Promise<EvaluationResult> {
	if (!spec.enabled) {
		return { matched: false, rule: undefined, value: spec.defaultValue };
	}
	if (spec.targetAppIDs && !spec.targetAppIDs.includes(context.applicationId)) {
		return { matched: false, rule: undefined, value: spec.defaultValue };
	}

	for (const rule of spec.rules) {
		const conditions = await Promise.all(rule.conditions.map((condition) => evaluateCondition(condition, context)));
		if (!conditions.every(Boolean)) continue;
		const unitId = getUnitId(context.user, rule.idType);
		if (!unitId) continue;
		const bucket = await rolloutBucket(`${spec.salt}:${rule.salt}:${unitId}`);
		if (bucket >= Math.round(rule.passPercentage * 100)) continue;
		return { matched: true, rule, value: rule.returnValue };
	}

	return { matched: false, rule: undefined, value: spec.defaultValue };
}

export function createEvaluationContext(ruleset: StatsigRuleset, user: TargetingUser, applicationId: string): EvaluationContext {
	return {
		ruleset,
		user,
		applicationId,
		segmentStack: new Set(),
	};
}

export function supportedCompatibilityEnvelope(): Record<string, string[]> {
	return {
		conditionTypes: [
			'public',
			'unit_id',
			'user_field',
			'custom_field',
			'environment_field',
			'current_time',
			'target_app',
			'segment',
			'user_bucket',
		],
		operators: [
			'eq',
			'neq',
			'any',
			'none',
			'gt',
			'gte',
			'lt',
			'lte',
			'contains_any',
			'contains_none',
			'str_starts_with_any',
			'str_ends_with_any',
			'str_matches',
			'regex',
			'version_gt',
			'version_gte',
			'version_lt',
			'version_lte',
			'before',
			'after',
			'on',
		],
	};
}
