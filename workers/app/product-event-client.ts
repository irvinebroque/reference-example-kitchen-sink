import {
	featureServiceEventRequestSchema,
	type FeatureSubject,
	type ProductEventName,
} from '../../shared/feature-contract';

export type ProductEventReporter = (eventName: ProductEventName) => Promise<void>;

function logReportingFailure(eventName: ProductEventName, details: { errorType?: string; status?: number }): void {
	console.error(
		JSON.stringify({
			event: 'product_event_report_failure',
			eventName,
			...details,
		}),
	);
}

export function createProductEventReporter(
	service: Service,
	user: { id?: string; email?: string | null } | null | undefined,
): ProductEventReporter {
	if (!user?.id) return async () => undefined;
	const subject = {
		id: user.id,
		email: user.email?.trim().toLowerCase() || undefined,
	};
	return (eventName) => recordProductEvent(service, eventName, subject);
}

export async function recordProductEvent(
	service: Service,
	eventName: ProductEventName,
	subject: FeatureSubject,
): Promise<void> {
	try {
		const payload = featureServiceEventRequestSchema.parse({
			event: eventName,
			subject,
		});
		const response = await service.fetch(
			new Request('https://feature.internal/v1/events/reference-gate-used', {
				body: JSON.stringify(payload),
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
				method: 'POST',
			}),
		);
		await response.body?.cancel();
		if (response.status !== 202) {
			logReportingFailure(eventName, { status: response.status });
		}
	} catch (error) {
		logReportingFailure(eventName, {
			errorType: error instanceof Error ? error.name : 'UnknownError',
		});
	}
}
