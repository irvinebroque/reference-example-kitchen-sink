import { Links, Meta, NavLink, Outlet, Scripts, ScrollRestoration, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { appContext, sessionContext, statsigContext } from './context';
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
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body>
				<header className="site-header">
					<div>
						<p className="eyebrow">Cloudflare Workers reference</p>
						<strong>Express + NextAuth + React Router + Statsig</strong>
					</div>
					<nav>
						<NavLink to="/">Overview</NavLink>
						<NavLink to="/protected">Protected</NavLink>
						<NavLink to="/form-demo">Form action</NavLink>
					</nav>
					<div className="session-actions">
						{data.session?.user ? (
							<>
								<span>{data.session.user.name}</span>
								<a href="/api/auth/signout?callbackUrl=/">Sign out</a>
							</>
						) : (
							<a href="/api/auth/signin?callbackUrl=/protected">Sign in</a>
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
		<section className="panel danger">
			<h1>Request failed</h1>
			<p>{message}</p>
		</section>
	);
}
