import type { StatsigServerlessClient } from '@statsig/serverless-client';
import type { ApplicationDecisions } from '../../shared/feature-contract';
import { welcomeConfigSchema } from './provider-contract';
import type { TargetingUser } from './statsig-user';

const REFERENCE_GATE = 'reference_gate';
const WELCOME_CONFIG = 'welcome_config';
const DEFAULT_WELCOME_MESSAGE = 'Welcome';

export function evaluateApplicationDecisions(
	client: StatsigServerlessClient,
	user: TargetingUser,
): ApplicationDecisions {
	let showReferenceExperience = false;
	let welcomeMessage = DEFAULT_WELCOME_MESSAGE;

	try {
		showReferenceExperience = client.checkGate(REFERENCE_GATE, user);
	} catch {
		// Provider evaluation errors fail closed at the application boundary.
	}

	try {
		const parsedWelcome = welcomeConfigSchema.safeParse(client.getDynamicConfig(WELCOME_CONFIG, user).value);
		if (parsedWelcome.success) welcomeMessage = parsedWelcome.data.message;
	} catch {
		// Malformed or unsupported provider data uses the application default.
	}

	return {
		showReferenceExperience,
		welcomeMessage,
	};
}
