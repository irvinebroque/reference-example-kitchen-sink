import type { AuthOptions } from 'next-auth';
import { createNextAuthBridge, type NextAuthBridge } from './compat/next-auth-bridge';
import { credentialsProvider } from './compat/next-auth-interop';
import { constantTimeEqual, verifyPbkdf2Password } from './password';

function createAuthOptions(env: Env): AuthOptions {
	return {
		secret: env.AUTH_SECRET,
		session: { strategy: 'jwt' },
		useSecureCookies: process.env.NODE_ENV === 'production',
		providers: [
			credentialsProvider({
				name: 'Reference credentials',
				credentials: {
					username: { label: 'Username', type: 'text' },
					password: { label: 'Password', type: 'password' },
				},
				async authorize(credentials) {
					const username = credentials?.username ?? '';
					const password = credentials?.password ?? '';
					const validUsername = constantTimeEqual(username, env.DEMO_USERNAME);
					const validPassword = await verifyPbkdf2Password(password, env.DEMO_PASSWORD_HASH);
					if (!validUsername || !validPassword) return null;
					return {
						id: `demo:${env.DEMO_USERNAME}`,
						name: env.DEMO_USERNAME,
						email: `${env.DEMO_USERNAME}@example.invalid`,
					};
				},
			}),
		],
		callbacks: {
			async jwt({ token, user }) {
				if (user?.id) token.sub = user.id;
				return token;
			},
			async session({ session, token }) {
				if (session.user) {
					session.user.id = token.sub ?? '';
				}
				return session;
			},
		},
		pages: {
			error: '/auth/error',
		},
	};
}

export type AuthService = NextAuthBridge;

export function createAuthService(env: Env): AuthService {
	const options = createAuthOptions(env);
	return createNextAuthBridge(options);
}
