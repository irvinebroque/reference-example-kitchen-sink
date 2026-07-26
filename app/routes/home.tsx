import { useRouteLoaderData } from 'react-router';
import type { loader as rootLoader } from '../root';

export function meta() {
	return [
		{ title: 'Workers reference application' },
		{
			name: 'description',
			content: 'Two-Worker reference for Express, React Router SSR, NextAuth, Statsig and Workers Cache.',
		},
	];
}

export default function Home() {
	const data = useRouteLoaderData<typeof rootLoader>('root');
	const gates = data?.statsig?.bootstrap.feature_gates ?? {};
	return (
		<>
			<section className="hero">
				<div>
					<p className="eyebrow">Two Workers, one visible request path</p>
					<h1>Reference architecture with cache behavior exposed.</h1>
					<p>
						The application Worker runs Express and React Router SSR. Authenticated requests make one Service Binding fetch to a private
						evaluator entrypoint.
					</p>
				</div>
				<div className="status-card">
					<span className="status-dot" />
					<div>
						<strong>{data?.session?.user ? 'Authenticated' : 'Anonymous'}</strong>
						<small>{data?.app.environment}</small>
					</div>
				</div>
			</section>

			<section className="grid">
				<article className="panel">
					<h2>Application deployment</h2>
					<dl>
						<dt>Application</dt>
						<dd>{data?.app.applicationId}</dd>
						<dt>Version</dt>
						<dd>{data?.app.version}</dd>
						<dt>Server</dt>
						<dd>Express via httpServerHandler</dd>
					</dl>
				</article>
				<article className="panel">
					<h2>Evaluator diagnostics</h2>
					{data?.statsig ? (
						<dl>
							<dt>Workers Cache</dt>
							<dd>{data.statsig.diagnostics.cacheStatus}</dd>
							<dt>Evaluator version</dt>
							<dd>{data.statsig.diagnostics.evaluatorVersion}</dd>
							<dt>Ruleset generation</dt>
							<dd>{data.statsig.diagnostics.rulesetGeneration}</dd>
							<dt>Payload</dt>
							<dd>{data.statsig.diagnostics.payloadBytes.toLocaleString()} bytes</dd>
						</dl>
					) : (
						<p>Sign in to issue the single evaluator Service Binding request.</p>
					)}
				</article>
				<article className="panel span-two">
					<h2>Evaluated feature gates</h2>
					{Object.keys(gates).length ? (
						<ul className="gate-list">
							{Object.entries(gates).map(([name, gate]) => (
								<li key={name}>
									<code>{name}</code>
									<strong className={gate.value ? 'enabled' : 'disabled'}>{String(gate.value)}</strong>
								</li>
							))}
						</ul>
					) : (
						<p>No gate payload is present for this request.</p>
					)}
				</article>
			</section>
		</>
	);
}
