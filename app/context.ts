import { createContext } from 'react-router';
import type { Session } from 'next-auth';
import type { StatsigAssignment } from '../shared/statsig-contract';

export interface AppMetadata {
	applicationId: string;
	environment: string;
	version: string;
	statsigClientKey: string;
}

export const appContext = createContext<AppMetadata>();
export const sessionContext = createContext<Session | null>(null);
export const statsigContext = createContext<StatsigAssignment | null>(null);
