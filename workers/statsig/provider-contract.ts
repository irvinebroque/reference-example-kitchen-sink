import { z } from 'zod';

export const welcomeConfigSchema = z.object({
	message: z.string(),
});
