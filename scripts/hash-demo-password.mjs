import { pbkdf2Sync, randomBytes } from 'node:crypto';

const password = process.argv[2];
if (!password) {
	console.error('Usage: pnpm run hash-password -- <password>');
	process.exit(1);
}

const iterations = 310_000;
const salt = randomBytes(18).toString('base64url');
const digest = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
console.log(`pbkdf2_sha256$${iterations}$${salt}$${digest}`);
