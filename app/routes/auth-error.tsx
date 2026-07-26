import { useSearchParams } from 'react-router';

export default function AuthError() {
	const [search] = useSearchParams();
	return (
		<section className="panel danger">
			<h1>Authentication failed</h1>
			<p>Error code: {search.get('error') ?? 'unknown'}</p>
			<a href="/api/auth/signin?callbackUrl=/protected">Try again</a>
		</section>
	);
}
