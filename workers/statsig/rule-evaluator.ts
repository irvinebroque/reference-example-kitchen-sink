import type { TargetingUser } from '../../shared/statsig-contract';
import type {
	CompiledCondition,
	CompiledRule,
	CompiledRuleset,
	CompiledSpec,
	ConditionEvaluationContext,
	ConditionRuntime,
} from './ruleset-model';

export interface EvaluationResult {
	matched: boolean;
	rule: CompiledRule | undefined;
	value: CompiledSpec['defaultValue'];
}

export type EvaluationContext = ConditionEvaluationContext;

const encoder = new TextEncoder();
const rootAncestry: ReadonlySet<string> = new Set();

function getUnitId(user: TargetingUser, idType: string): string | undefined {
	return idType === 'userID' ? user.userID : user.customIDs?.[idType];
}

async function rolloutBucket(input: string): Promise<number> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
	const bytes = new Uint8Array(digest);
	const value = ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
	return (value >>> 0) % 10_000;
}

async function evaluateSegment(name: string, context: ConditionEvaluationContext, ancestry: ReadonlySet<string>): Promise<boolean> {
	if (ancestry.has(name)) return false;
	const segment = context.ruleset.segments.get(name);
	if (!segment) return false;
	const nextAncestry = new Set(ancestry);
	nextAncestry.add(name);
	return (await evaluateSpec(segment, context, nextAncestry)).matched;
}

const conditionRuntime: ConditionRuntime = {
	evaluateSegment,
};

function evaluateCondition(condition: CompiledCondition, context: EvaluationContext, ancestry: ReadonlySet<string>): Promise<boolean> {
	return condition.test(conditionRuntime, context, ancestry);
}

export async function evaluateSpec(
	spec: CompiledSpec,
	context: EvaluationContext,
	ancestry: ReadonlySet<string> = rootAncestry,
): Promise<EvaluationResult> {
	if (!spec.enabled) {
		return { matched: false, rule: undefined, value: spec.defaultValue };
	}
	if (spec.targetAppIDs && !spec.targetAppIDs.includes(context.applicationId)) {
		return { matched: false, rule: undefined, value: spec.defaultValue };
	}

	for (const rule of spec.rules) {
		const conditions = await Promise.all(rule.conditions.map((condition) => evaluateCondition(condition, context, ancestry)));
		if (!conditions.every(Boolean)) continue;
		const unitId = getUnitId(context.user, rule.idType);
		if (!unitId) continue;
		const bucket = await rolloutBucket(`${spec.salt}:${rule.salt}:${unitId}`);
		if (bucket >= Math.round(rule.passPercentage * 100)) continue;
		return { matched: true, rule, value: rule.returnValue };
	}

	return { matched: false, rule: undefined, value: spec.defaultValue };
}

export function createEvaluationContext(
	ruleset: CompiledRuleset,
	user: TargetingUser,
	applicationId: string,
	now: () => Date = () => new Date(),
): EvaluationContext {
	return {
		ruleset,
		user,
		applicationId,
		now,
	};
}
