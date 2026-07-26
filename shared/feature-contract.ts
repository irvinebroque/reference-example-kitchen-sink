import { z } from 'zod';

export const featureSubjectSchema = z.object({
	id: z.string().trim().min(1).max(256),
	email: z.string().trim().toLowerCase().email().optional(),
});

export const featureServiceRequestSchema = z.object({
	subject: featureSubjectSchema,
});

export const applicationDecisionsSchema = z.object({
	showReferenceExperience: z.boolean(),
	welcomeMessage: z.string(),
});

export const featureServiceResponseSchema = z.object({
	decisions: applicationDecisionsSchema,
	diagnostics: z.object({
		evaluatorVersion: z.string(),
		configurationGeneration: z.string(),
		configurationStale: z.boolean(),
		evaluationDurationMs: z.number(),
		payloadBytes: z.number(),
	}),
});

export type FeatureSubject = z.infer<typeof featureSubjectSchema>;
export type FeatureServiceRequest = z.infer<typeof featureServiceRequestSchema>;
export type ApplicationDecisions = z.infer<typeof applicationDecisionsSchema>;
export type FeatureServiceResponse = z.infer<typeof featureServiceResponseSchema>;

export interface FeatureSnapshot extends FeatureServiceResponse {
	diagnostics: FeatureServiceResponse['diagnostics'] & {
		cacheStatus: string;
	};
}
