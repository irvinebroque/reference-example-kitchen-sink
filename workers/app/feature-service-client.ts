import { featureServiceResponseSchema, type FeatureSnapshot } from '../../shared/feature-contract';

export async function loadFeatureSnapshot(
	service: Service,
	user: { id: string; email?: string | null },
): Promise<FeatureSnapshot> {
	const response = await service.fetch(
		new Request('https://feature.internal/v1/decisions', {
			body: JSON.stringify({
				subject: {
					id: user.id,
					email: user.email?.trim().toLowerCase() || undefined,
				},
			}),
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			method: 'POST',
		}),
	);
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`Feature service returned ${response.status}`);
	}
	const parsed = featureServiceResponseSchema.parse(await response.json());
	return {
		...parsed,
		diagnostics: {
			...parsed.diagnostics,
			cacheStatus: response.headers.get('cf-cache-status') ?? 'LOCAL/UNKNOWN',
		},
	};
}
