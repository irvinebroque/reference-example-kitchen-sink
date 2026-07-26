import { RulesetRepository, StatsigRulesetSource, VolatileRulesetValueCache } from './ruleset-cache';
import { positiveNumberSetting } from './responses';

let repository: RulesetRepository | undefined;

export function getRulesetRepository(env: StatsigEnv): RulesetRepository {
	repository ??= new RulesetRepository(
		new StatsigRulesetSource(env.STATSIG_SERVER_SECRET),
		new VolatileRulesetValueCache(env.RULESET_CACHE),
		positiveNumberSetting(env.RULESET_TTL_SECONDS, 300),
	);
	return repository;
}
