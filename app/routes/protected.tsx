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
		<section className="panel">
			<p className="eyebrow">Protected SSR route</p>
			<h1>Welcome, {data.user.name}</h1>
			<p>This document was rendered after one session lookup and one Statsig Service Binding fetch.</p>
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
		</section>
	);
}
