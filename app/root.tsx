import { CloudflareLogo } from '@cloudflare/kumo/components/cloudflare-logo';
import { LayerCard } from '@cloudflare/kumo/components/layer-card';
import { Link } from '@cloudflare/kumo/components/link';
import { Text } from '@cloudflare/kumo/components/text';
import { Links, Meta, NavLink, Outlet, Scripts, ScrollRestoration, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { requestContext } from './context';
import '@cloudflare/kumo/styles/standalone';
import './styles.css';

export function loader({ context }: LoaderFunctionArgs) {
	const { app, session } = context.get(requestContext);
	return { app, session };
}

export function Layout({ children }: { children: React.ReactNode }) {
	const data = useLoaderData<typeof loader>();

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
					</nav>
					<div className="session-actions">
						{data?.session?.user ? (
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
