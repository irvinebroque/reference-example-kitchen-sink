import type { TargetingUser } from '../../shared/statsig-contract';
import type { JsonValue } from './ruleset-schema';

export type ConditionValue = JsonValue | undefined;
export type CompiledPredicate = (actual: ConditionValue) => boolean;

export interface ConditionEvaluationContext {
	readonly ruleset: CompiledRuleset;
	readonly user: TargetingUser;
	readonly applicationId: string;
	readonly now: () => Date;
}

export interface ConditionRuntime {
	evaluateSegment(name: string, context: ConditionEvaluationContext, ancestry: ReadonlySet<string>): Promise<boolean>;
}

export type ConditionTest = (
	runtime: ConditionRuntime,
	context: ConditionEvaluationContext,
	ancestry: ReadonlySet<string>,
) => Promise<boolean>;

interface CompiledConditionBase {
	readonly test: ConditionTest;
}

export interface PublicCondition extends CompiledConditionBase {
	readonly kind: 'public';
}

export interface UnitIdCondition extends CompiledConditionBase {
	readonly kind: 'unitId';
	readonly idType: string;
	readonly predicate: CompiledPredicate;
}

export interface UserFieldCondition extends CompiledConditionBase {
	readonly kind: 'userField';
	readonly field: string;
	readonly predicate: CompiledPredicate;
}

export interface CurrentTimeCondition extends CompiledConditionBase {
	readonly kind: 'currentTime';
	readonly predicate: CompiledPredicate;
}

export interface TargetApplicationCondition extends CompiledConditionBase {
	readonly kind: 'targetApplication';
	readonly predicate: CompiledPredicate;
}

export interface SegmentCondition extends CompiledConditionBase {
	readonly kind: 'segment';
	readonly segmentName: string;
}

export interface UserBucketCondition extends CompiledConditionBase {
	readonly kind: 'userBucket';
	readonly idType: string;
	readonly field: string;
	readonly bucketSalt: string;
	readonly predicate: CompiledPredicate;
}

export interface UnsupportedCondition extends CompiledConditionBase {
	readonly kind: 'unsupported';
	readonly externalType: string;
}

export type CompiledCondition =
	| PublicCondition
	| UnitIdCondition
	| UserFieldCondition
	| CurrentTimeCondition
	| TargetApplicationCondition
	| SegmentCondition
	| UserBucketCondition
	| UnsupportedCondition;

export interface CompiledRule {
	readonly name: string;
	readonly passPercentage: number;
	readonly conditions: readonly CompiledCondition[];
	readonly returnValue: JsonValue;
	readonly id: string;
	readonly salt: string;
	readonly idType: string;
	readonly configDelegate: string | null;
	readonly isExperimentGroup?: boolean;
	readonly groupName?: string;
}

export interface CompiledSpec {
	readonly name: string;
	readonly type: string;
	readonly salt: string;
	readonly defaultValue: JsonValue;
	readonly enabled: boolean;
	readonly idType: string;
	readonly rules: readonly CompiledRule[];
	readonly entity: string;
	readonly explicitParameters: readonly string[] | null;
	readonly hasSharedParams: boolean;
	readonly isActive?: boolean;
	readonly targetAppIDs?: readonly string[];
	readonly version?: number;
}

export interface CompiledRuleset {
	readonly featureGates: readonly CompiledSpec[];
	readonly dynamicConfigs: readonly CompiledSpec[];
	readonly layerConfigs: readonly CompiledSpec[];
	readonly segments: ReadonlyMap<string, CompiledSpec>;
	readonly time: number;
	readonly hasUpdates: boolean;
	readonly sdkInfo?: Readonly<Record<string, string>>;
	readonly defaultEnvironment?: string;
	readonly applicationId?: string;
}
