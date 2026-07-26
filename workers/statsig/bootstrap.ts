import { type BootstrapResponse, type TargetingUser, toStatsigUser } from '../shared/statsig-contract';
import { createEvaluationContext, evaluateSpec, type EvaluationResult } from './rule-evaluator';
import type { StatsigRuleset, StatsigSpec } from './ruleset-schema';

function configValue(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function evaluationBase(spec: StatsigSpec, result: EvaluationResult) {
	return {
		name: spec.name,
		rule_id: result.rule?.id ?? '',
		id_type: result.rule?.idType ?? spec.idType,
		secondary_exposures: [],
		version: spec.version === undefined ? undefined : String(spec.version),
	};
}

export async function createBootstrap(ruleset: StatsigRuleset, user: TargetingUser, applicationId: string): Promise<BootstrapResponse> {
	const context = createEvaluationContext(ruleset, user, applicationId);
	const featureGates: BootstrapResponse['feature_gates'] = {};
	const dynamicConfigs: BootstrapResponse['dynamic_configs'] = {};
	const layerConfigs: BootstrapResponse['layer_configs'] = {};

	for (const spec of ruleset.feature_gates) {
		const result = await evaluateSpec(spec, context);
		featureGates[spec.name] = {
			...evaluationBase(spec, result),
			value: Boolean(result.value),
		};
	}

	for (const spec of ruleset.dynamic_configs) {
		const result = await evaluateSpec(spec, context);
		dynamicConfigs[spec.name] = {
			...evaluationBase(spec, result),
			value: configValue(result.value),
			group: result.rule?.id ?? '',
			group_name: result.rule?.groupName,
			is_device_based: spec.idType !== 'userID',
			is_experiment_active: spec.isActive,
			is_user_in_experiment: result.rule?.isExperimentGroup,
			passed: result.matched,
			explicit_parameters: spec.explicitParameters ?? undefined,
		};
	}

	for (const spec of ruleset.layer_configs) {
		const result = await evaluateSpec(spec, context);
		layerConfigs[spec.name] = {
			...evaluationBase(spec, result),
			value: configValue(result.value),
			group: result.rule?.id ?? '',
			group_name: result.rule?.groupName,
			is_device_based: spec.idType !== 'userID',
			allocated_experiment_name: result.rule?.configDelegate ?? '',
			explicit_parameters: spec.explicitParameters ?? [],
		};
	}

	return {
		feature_gates: featureGates,
		dynamic_configs: dynamicConfigs,
		layer_configs: layerConfigs,
		has_updates: true,
		time: ruleset.time,
		generator: 'reference-custom-evaluator',
		sdkInfo: {
			sdkType: 'cloudflare-workers-reference',
			sdkVersion: '1.0.0',
		},
		evaluated_keys: {
			userID: user.userID,
			customIDs: user.customIDs ?? {},
		},
		hash_used: 'none',
		user: toStatsigUser(user),
	};
}
