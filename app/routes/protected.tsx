import { LayerCard } from '@cloudflare/kumo/components/layer-card';
import { Text } from '@cloudflare/kumo/components/text';
import { redirect, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { sessionContext, statsigContext } from '../context';

export function loader({ context }: LoaderFunctionArgs) {
	const session = context.get(sessionContext);
	if (!session?.user) {
		throw redirect('/api/auth/signin?callbackUrl=/protected');
	}
	return {
		user: session.user,
		statsig: context.get(statsigContext),
	};
}

export default function ProtectedRoute() {
	const data = useLoaderData<typeof loader>();
	return (
		<div className="page-shell narrow">
			<section className="page-heading">
				<div className="heading-copy">
					<Text variant="heading1" as="h1">
						Welcome, {data.user.name ?? 'user'}
					</Text>
					<Text variant="secondary">This protected page was rendered after one session lookup and one Statsig service binding fetch.</Text>
				</div>
			</section>

			<LayerCard className="content-card">
				<Text variant="heading3" as="h2">
					Request details
				</Text>
				<pre>
					{JSON.stringify(
						{
							user: data.user,
							diagnostics: data.statsig?.diagnostics,
						},
						null,
						2,
					)}
				</pre>
			</LayerCard>
		</div>
	);
}
