import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
	index('routes/home.tsx'),
	route('protected', 'routes/protected.tsx'),
	route('auth/signin', 'routes/auth-signin.tsx'),
	route('auth/error', 'routes/auth-error.tsx'),
] satisfies RouteConfig;
