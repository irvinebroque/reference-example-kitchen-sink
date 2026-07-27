import type { StatsigServerlessClient } from '@statsig/serverless-client';
import type { ApplicationDecisions } from '../../shared/feature-contract';
import { welcomeConfigSchema } from './provider-contract';
import type { TargetingUser } from './statsig-user';

const STATSIG_GATE = 'reference_gate';
const WELCOME_CONFIG = 'welcome_config';
const DEFAULT_WELCOME_MESSAGE = 'Welcome';

export interface ExposurePolicy {
	logExposures: boolean;
}

export function evaluateApplicationDecisions(
	client: StatsigServerlessClient,
	user: TargetingUser,
	exposurePolicy: ExposurePolicy,
): ApplicationDecisions {
	let statsigGateEnabled = false;
	let welcomeMessage = DEFAULT_WELCOME_MESSAGE;

	try {
		statsigGateEnabled = client.checkGate(STATSIG_GATE, user, {
			disableExposureLog: !exposurePolicy.logExposures,
		});
	} catch {
		// Provider evaluation errors fail closed at the application boundary.
	}

	try {
		const parsedWelcome = welcomeConfigSchema.safeParse(
			client.getDynamicConfig(WELCOME_CONFIG, user, { disableExposureLog: !exposurePolicy.logExposures }).value,
		);
		if (parsedWelcome.success) welcomeMessage = parsedWelcome.data.message;
	} catch {
		// Malformed or unsupported provider data uses the application default.
	}

	return {
		statsigGateEnabled,
		welcomeMessage,
	};
}
