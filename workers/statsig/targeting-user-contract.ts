import { z } from 'zod';

const statsigPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

export const targetingUserSchema = z.object({
	userID: z.string().min(1),
	privateAttributes: z.object({ email: z.string().email() }).optional(),
	customIDs: z.record(z.string(), z.string()).optional(),
	custom: z.record(z.string(), statsigPrimitiveSchema).optional(),
	statsigEnvironment: z.object({ tier: z.string().min(1) }),
});

export type TargetingUser = z.infer<typeof targetingUserSchema>;
