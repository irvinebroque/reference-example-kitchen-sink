import { Badge } from '@cloudflare/kumo/components/badge';
import { LayerCard } from '@cloudflare/kumo/components/layer-card';
import { Text } from '@cloudflare/kumo/components/text';
import { useRouteLoaderData } from 'react-router';
import type { loader as rootLoader } from '../root';

export function meta() {
	return [
		{ title: 'Workers reference application' },
		{
			name: 'description',
			content: 'Two-Worker reference for React Router SSR, NextAuth, Statsig and Workers Cache.',
		},
	];
}

export default function Home() {
	const data = useRouteLoaderData<typeof rootLoader>('root');
	const gates = data?.statsig?.bootstrap.feature_gates ?? {};
	return (
		<div className="page-shell">
			<section className="page-heading">
				<div className="heading-copy">
					<Text variant="heading1" as="h1">
						Workers reference
					</Text>
					<Text variant="secondary">A small reference for React Router SSR, NextAuth, Statsig, and Workers Cache.</Text>
				</div>
				<Badge variant={data?.session?.user ? 'success' : 'neutral'} appearance="dot">
					{data?.session?.user ? 'Authenticated' : 'Anonymous'}
				</Badge>
			</section>

			<section className="dashboard-grid" aria-label="Deployment overview">
				<LayerCard className="content-card">
					<div className="card-heading">
						<Text variant="heading3" as="h2">
							Application deployment
						</Text>
						<Text variant="secondary">{data?.app.environment}</Text>
					</div>
					<dl>
						<Text as="dt" variant="secondary">
							Application
						</Text>
						<Text as="dd">{data?.app.applicationId}</Text>
						<Text as="dt" variant="secondary">
							Version
						</Text>
						<Text as="dd">{data?.app.version}</Text>
						<Text as="dt" variant="secondary">
							Server
						</Text>
						<Text as="dd">
							React Router via the native <code className="inline-code">fetch()</code> adapter
						</Text>
					</dl>
				</LayerCard>

				<LayerCard className="content-card">
					<div className="card-heading">
						<Text variant="heading3" as="h2">
							Evaluator diagnostics
						</Text>
						<Text variant="secondary">Private service binding</Text>
					</div>
					{data?.statsig ? (
						<dl>
							<Text as="dt" variant="secondary">
								Workers Cache
							</Text>
							<Text as="dd">{data.statsig.diagnostics.cacheStatus}</Text>
							<Text as="dt" variant="secondary">
								Evaluator version
							</Text>
							<Text as="dd">{data.statsig.diagnostics.evaluatorVersion}</Text>
							<Text as="dt" variant="secondary">
								Ruleset generation
							</Text>
							<Text as="dd">{data.statsig.diagnostics.rulesetGeneration}</Text>
							<Text as="dt" variant="secondary">
								Payload
							</Text>
							<Text as="dd">{data.statsig.diagnostics.payloadBytes.toLocaleString()} bytes</Text>
						</dl>
					) : (
						<Text variant="secondary">Sign in to issue the evaluator service binding request.</Text>
					)}
				</LayerCard>

				<LayerCard className="content-card gates-card">
					<div className="card-heading">
						<Text variant="heading3" as="h2">
							Evaluated feature gates
						</Text>
						<Text variant="secondary">Current request</Text>
					</div>
					{Object.keys(gates).length ? (
						<ul className="gate-list">
							{Object.entries(gates).map(([name, gate]) => (
								<li key={name}>
									<code className="inline-code">{name}</code>
									<Badge variant={gate.value ? 'success' : 'neutral'} appearance="dot">
										{gate.value ? 'Enabled' : 'Disabled'}
									</Badge>
								</li>
							))}
						</ul>
					) : (
						<Text variant="secondary">No gate payload is present for this request.</Text>
					)}
				</LayerCard>
			</section>
		</div>
	);
}
