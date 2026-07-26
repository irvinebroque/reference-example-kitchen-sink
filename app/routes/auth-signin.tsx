import { Button } from '@cloudflare/kumo/components/button';
import { Input } from '@cloudflare/kumo/components/input';
import { LayerCard } from '@cloudflare/kumo/components/layer-card';
import { Text } from '@cloudflare/kumo/components/text';
import { data, redirect, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { authContext, demoCredentialsContext, sessionContext } from '../context';

function callbackUrlFor(request: Request): string {
	const requestUrl = new URL(request.url);
	const requestedCallback = requestUrl.searchParams.get('callbackUrl');
	if (!requestedCallback) return '/protected';

	try {
		const callback = new URL(requestedCallback, requestUrl);
		if (callback.origin !== requestUrl.origin) return '/protected';
		return `${callback.pathname}${callback.search}${callback.hash}`;
	} catch {
		return '/protected';
	}
}

export async function loader({ context, request }: LoaderFunctionArgs) {
	const callbackUrl = callbackUrlFor(request);
	if (context.get(sessionContext)?.user) throw redirect(callbackUrl);

	const auth = context.get(authContext);
	const csrfResponse = await auth.handle(
		new Request(new URL('/api/auth/csrf', request.url), {
			headers: request.headers,
		}),
	);
	if (!csrfResponse.ok) {
		throw new Response('Unable to prepare sign in', { status: csrfResponse.status });
	}

	const csrfPayload = (await csrfResponse.json()) as { csrfToken?: unknown };
	if (typeof csrfPayload.csrfToken !== 'string') {
		throw new Response('Unable to prepare sign in', { status: 500 });
	}

	const headers = new Headers();
	for (const cookie of csrfResponse.headers.getSetCookie()) headers.append('Set-Cookie', cookie);

	return data(
		{
			callbackUrl,
			credentials: context.get(demoCredentialsContext),
			csrfToken: csrfPayload.csrfToken,
			error: new URL(request.url).searchParams.get('error'),
		},
		{ headers },
	);
}

export default function SignIn() {
	const { callbackUrl, credentials, csrfToken, error } = useLoaderData<typeof loader>();

	return (
		<div className="auth-page">
			<div className="auth-panel">
				<div className="auth-heading">
					<Text variant="heading1" as="h1">
						Sign in
					</Text>
					<Text variant="secondary">Use the demo account to open the protected reference application.</Text>
				</div>

				<LayerCard className="auth-card">
					<form method="post" action="/api/auth/callback/credentials" className="auth-form">
						<input type="hidden" name="csrfToken" value={csrfToken} />
						<input type="hidden" name="callbackUrl" value={callbackUrl} />
						{error ? (
							<Text variant="error" size="sm" role="alert">
								The username or password was not recognized. Try the demo credentials below.
							</Text>
						) : null}
						<Input label="Username" name="username" type="text" autoComplete="username" defaultValue={credentials.username} required />
						<Input
							label="Password"
							name="password"
							type="password"
							autoComplete="current-password"
							defaultValue={credentials.password}
							required
						/>
						<Button type="submit" variant="primary" size="lg">
							Sign in
						</Button>
					</form>

					<div className="demo-credentials">
						<Text as="p" variant="secondary" size="xs">
							Demo credentials
						</Text>
						<Text as="p" variant="secondary" size="sm">
							Username <code>{credentials.username}</code> · Password <code>{credentials.password}</code>
						</Text>
					</div>
				</LayerCard>
			</div>
		</div>
	);
}
