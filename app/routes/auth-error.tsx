import { LayerCard } from '@cloudflare/kumo/components/layer-card';
import { Link } from '@cloudflare/kumo/components/link';
import { Text } from '@cloudflare/kumo/components/text';
import { useSearchParams } from 'react-router';

export default function AuthError() {
	const [search] = useSearchParams();
	return (
		<div className="page-shell narrow">
			<LayerCard className="content-card error-card">
				<Text variant="heading1" as="h1">
					Authentication failed
				</Text>
				<Text variant="error">Error code: {search.get('error') ?? 'unknown'}</Text>
				<Link href="/api/auth/signin?callbackUrl=/protected">Try again</Link>
			</LayerCard>
		</div>
	);
}
