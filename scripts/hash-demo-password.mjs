import { pbkdf2Sync, randomBytes } from 'node:crypto';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--') arguments_.shift();
const [password] = arguments_;
if (!password || arguments_.length !== 1) {
	console.error('Usage: pnpm run hash-password -- <password>');
	process.exit(1);
}

const iterations = 100_000;
const salt = randomBytes(18).toString('base64url');
const digest = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
console.log(`pbkdf2_sha256$${iterations}$${salt}$${digest}`);
