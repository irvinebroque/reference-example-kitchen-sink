import { CloudflareLogo } from '@cloudflare/kumo/components/cloudflare-logo';
import { LayerCard } from '@cloudflare/kumo/components/layer-card';
import { Link } from '@cloudflare/kumo/components/link';
import { Text } from '@cloudflare/kumo/components/text';
import { Links, Meta, NavLink, Outlet, Scripts, ScrollRestoration, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { appContext, sessionContext, statsigContext } from './context';
import '@cloudflare/kumo/styles/standalone';
import './styles.css';

export function headers() {
	return { 'Cache-Control': 'private, no-store' };
}

export function loader({ context }: LoaderFunctionArgs) {
	return {
		app: context.get(appContext),
		session: context.get(sessionContext),
		statsig: context.get(statsigContext),
	};
}

function safeScriptJson(value: unknown): string {
	return JSON.stringify(value)
		.replaceAll('<', '\\u003c')
		.replaceAll('>', '\\u003e')
		.replaceAll('&', '\\u0026')
		.replaceAll('\u2028', '\\u2028')
		.replaceAll('\u2029', '\\u2029');
}

export function Layout({ children }: { children: React.ReactNode }) {
	const data = useLoaderData<typeof loader>();
	const bootstrapScript = data.statsig
		? `window.__REFERENCE_BOOTSTRAP__=${safeScriptJson({
				clientKey: data.app.statsigClientKey,
				user: data.statsig.bootstrap.user,
				bootstrap: data.statsig.bootstrap,
			})};`
		: '';

	return (
		<html lang="en" data-theme="kumo" data-mode="light">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body>
				<header className="site-header">
					<NavLink to="/" className="brand" aria-label="Workers reference home">
						<CloudflareLogo variant="glyph" width={30} height={18} aria-hidden="true" />
						<span>Workers reference</span>
					</NavLink>
					<nav aria-label="Primary navigation">
						<NavLink to="/" end>
							Overview
						</NavLink>
						<NavLink to="/protected">Protected route</NavLink>
						<NavLink to="/form-demo">Form action</NavLink>
					</nav>
					<div className="session-actions">
						{data.session?.user ? (
							<>
								<Text as="span" truncate>
									{data.session.user.name ?? data.session.user.email ?? 'Signed in'}
								</Text>
								<Link href="/api/auth/signout?callbackUrl=/" variant="plain">
									Sign out
								</Link>
							</>
						) : (
							<Link href="/api/auth/signin?callbackUrl=/protected" variant="plain">
								Sign in
							</Link>
						)}
					</div>
				</header>
				<main>{children}</main>
				{bootstrapScript ? <script dangerouslySetInnerHTML={{ __html: bootstrapScript }} /> : null}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
	const message = error instanceof Error ? error.message : 'Unknown error';
	return (
		<section className="page-shell">
			<LayerCard className="content-card error-card">
				<Text variant="heading1" as="h1">
					Request failed
				</Text>
				<Text variant="error">{message}</Text>
			</LayerCard>
		</section>
	);
}
