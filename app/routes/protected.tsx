import { LayerCard } from '@cloudflare/kumo/components/layer-card';
import { Text } from '@cloudflare/kumo/components/text';
import { redirectDocument, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { requestContext } from '../context';

export async function loader({ context }: LoaderFunctionArgs) {
	const { getFeatures, session } = context.get(requestContext);
	if (!session?.user) {
		throw redirectDocument('/api/auth/signin?callbackUrl=/protected');
	}
	return {
		user: session.user,
		features: await getFeatures(),
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
					<Text variant="secondary">This protected page was rendered after one session lookup and one feature service binding fetch.</Text>
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
							decisions: data.features?.decisions,
							diagnostics: data.features?.diagnostics,
						},
						null,
						2,
					)}
				</pre>
			</LayerCard>
		</div>
	);
}
