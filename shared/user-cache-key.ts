import { timingSafeEqual } from 'node:crypto';
import type { TargetingUser } from './statsig-contract';

const encoder = new TextEncoder();

function sortValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortValue);
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, sortValue(entry)]),
		);
	}
	return value;
}

export function canonicalizeUser(user: TargetingUser): string {
	return JSON.stringify(sortValue(user));
}

function bytesToHex(bytes: ArrayBuffer): string {
	return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function createUserCacheKey(user: TargetingUser, secret: string): Promise<string> {
	const signature = await crypto.subtle.sign('HMAC', await importHmacKey(secret), encoder.encode(canonicalizeUser(user)));
	return `v1_${bytesToHex(signature)}`;
}

export async function verifyUserCacheKey(user: TargetingUser, secret: string, expected: string): Promise<boolean> {
	if (!expected.startsWith('v1_')) {
		return false;
	}
	const actual = await createUserCacheKey(user, secret);
	const actualBytes = encoder.encode(actual);
	const expectedBytes = encoder.encode(expected);
	if (actualBytes.byteLength !== expectedBytes.byteLength) {
		return false;
	}
	return timingSafeEqual(actualBytes, expectedBytes);
}
