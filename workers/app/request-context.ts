import type { RequestHandler } from 'express';
import type { Session } from 'next-auth';
import type { StatsigAssignment } from '../../shared/statsig-contract';
import type { AuthService } from './auth';
import type { StatsigService } from './statsig-client';

declare global {
	namespace Express {
		interface Locals {
			session: Session | null;
			statsig: StatsigAssignment | null;
		}
	}
}

export function createRequestContextMiddleware(auth: AuthService, statsig: StatsigService): RequestHandler {
	return async (request, response, next) => {
		try {
			const session = await auth.loadSession(request, response);
			response.locals.session = session;
			response.locals.statsig = session?.user?.id
				? await statsig.loadAssignment({
						id: session.user.id,
						email: session.user.email,
					})
				: null;
			next();
		} catch (error) {
			next(error);
		}
	};
}
