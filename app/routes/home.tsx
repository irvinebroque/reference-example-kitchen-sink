import { Badge } from '@cloudflare/kumo/components/badge';
import { LayerCard } from '@cloudflare/kumo/components/layer-card';
import { Text } from '@cloudflare/kumo/components/text';
import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { requestContext } from '../context';

export async function loader({ context }: LoaderFunctionArgs) {
	const { app, getFeatures, session } = context.get(requestContext);
	return {
		app,
		features: await getFeatures(),
		session,
	};
}

export function meta() {
	return [
		{ title: 'Workers reference application' },
		{
			name: 'description',
			content: 'Two-Worker reference for React Router SSR, NextAuth, Statsig feature decisions, and Workers Cache.',
		},
	];
}

export default function Home() {
	const data = useLoaderData<typeof loader>();
	return (
		<div className="page-shell">
			<section className="page-heading">
				<div className="heading-copy">
					<Text variant="heading1" as="h1">
						Workers reference
					</Text>
					<Text variant="secondary">
						A small reference for React Router SSR, NextAuth, Statsig feature decisions, and Workers Cache.
					</Text>
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
							Feature evaluator
						</Text>
						<Text variant="secondary">Feature service binding</Text>
					</div>
					{data?.features ? (
						<dl>
							<Text as="dt" variant="secondary">
								Workers Cache
							</Text>
							<Text as="dd">{data.features.diagnostics.cacheStatus}</Text>
							<Text as="dt" variant="secondary">
								Evaluator version
							</Text>
							<Text as="dd">{data.features.diagnostics.evaluatorVersion}</Text>
							<Text as="dt" variant="secondary">
								Configuration generation
							</Text>
							<Text as="dd">{data.features.diagnostics.configurationGeneration}</Text>
							<Text as="dt" variant="secondary">
								Payload
							</Text>
							<Text as="dd">{data.features.diagnostics.payloadBytes.toLocaleString()} bytes</Text>
						</dl>
					) : (
						<Text variant="secondary">Sign in to issue the evaluator service binding request.</Text>
					)}
				</LayerCard>

				<LayerCard className="content-card gates-card">
					<div className="card-heading">
						<Text variant="heading3" as="h2">
							Application decisions
						</Text>
						<Text variant="secondary">Current request</Text>
					</div>
					{data?.features ? (
						<ul className="gate-list">
							<li>
								<span>
									Statsig gate <code className="inline-code">reference_gate</code>
								</span>
								<Badge
									variant={data.features.decisions.statsigGateEnabled ? 'success' : 'neutral'}
									appearance="dot"
								>
									{data.features.decisions.statsigGateEnabled ? 'Enabled' : 'Disabled'}
								</Badge>
							</li>
						</ul>
					) : (
						<Text variant="secondary">No feature decisions are present for this request.</Text>
					)}
				</LayerCard>
			</section>
		</div>
	);
}
