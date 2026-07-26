import { createContext } from 'react-router';
import type { Session } from 'next-auth';
import type { FeatureSnapshot } from '../shared/feature-contract';

export interface AppMetadata {
	applicationId: string;
	environment: string;
	version: string;
}

export interface AuthRequestHandler {
	handle(request: Request): Promise<Response>;
}

export interface DemoCredentials {
	username: string;
	password: string;
}

export interface AppRequestContext {
	app: AppMetadata;
	session: Session | null;
	getFeatures(): Promise<FeatureSnapshot | null>;
}

export const requestContext = createContext<AppRequestContext>();
export const authContext = createContext<AuthRequestHandler>();
export const demoCredentialsContext = createContext<DemoCredentials>();
