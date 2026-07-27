import { timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();
const PBKDF2_ITERATIONS = 100_000;

function hexToBytes(value: string): Uint8Array | undefined {
	if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) return undefined;
	return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

export function constantTimeEqual(left: string, right: string): boolean {
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

export async function verifyPbkdf2Password(password: string, encodedHash: string): Promise<boolean> {
	const [algorithm, iterationsValue, salt, expectedHex] = encodedHash.split('$');
	if (algorithm !== 'pbkdf2_sha256' || !iterationsValue || !salt || !expectedHex) return false;

	const iterations = Number(iterationsValue);
	const expected = hexToBytes(expectedHex);
	if (!Number.isSafeInteger(iterations) || iterations !== PBKDF2_ITERATIONS || !expected) return false;

	const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
	const actual = new Uint8Array(
		await crypto.subtle.deriveBits(
			{
				name: 'PBKDF2',
				hash: 'SHA-256',
				iterations,
				salt: encoder.encode(salt),
			},
			key,
			expected.byteLength * 8,
		),
	);
	return timingSafeEqual(actual, expected);
}
