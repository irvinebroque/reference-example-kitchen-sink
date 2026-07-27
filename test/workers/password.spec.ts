import { describe, expect, it } from 'vitest';
import { verifyPbkdf2Password } from '../../workers/app/password';

const demoPasswordHash =
	'pbkdf2_sha256$100000$salt$ac7d652639c389d536170d502b8e1ab2f5408a309d144e1aae216116d3594eb4';

describe('password verification in the Workers runtime', () => {
	it('verifies the generated 100,000-iteration password format', async () => {
		await expect(verifyPbkdf2Password('demo-password', demoPasswordHash)).resolves.toBe(true);
		await expect(verifyPbkdf2Password('incorrect-password', demoPasswordHash)).resolves.toBe(false);
	});

	it('rejects malformed, weakened, or unsupported hashes', async () => {
		await expect(verifyPbkdf2Password('demo-password', 'not-a-password-hash')).resolves.toBe(false);
		await expect(
			verifyPbkdf2Password(
				'demo-password',
				'pbkdf2_sha256$99999$salt$3e2e2605fd3aff7f2c92065d0393ddbb344f20b7dfc7e5de78a840e0eb1b118f',
			),
		).resolves.toBe(false);
		await expect(
			verifyPbkdf2Password(
				'demo-password',
				'pbkdf2_sha256$100001$salt$3e2e2605fd3aff7f2c92065d0393ddbb344f20b7dfc7e5de78a840e0eb1b118f',
			),
		).resolves.toBe(false);
	});
});
