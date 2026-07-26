import zodCompiler from 'zod-compiler/vite';

export const zodCompilerOptions = {
	schemas: 'auto',
	output: 'bag',
	stripUnknownKeys: true,
	include: [
		'shared/feature-contract.ts',
		'workers/statsig/provider-contract.ts',
		'workers/statsig/targeting-user-contract.ts',
	],
} satisfies NonNullable<Parameters<typeof zodCompiler>[0]>;

export function compiledZodSchemas() {
	return zodCompiler(zodCompilerOptions);
}
