import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const deployConfigPath = path.resolve('.wrangler/deploy/config.json');

async function readCurrentDeployConfig() {
	try {
		return await readFile(deployConfigPath);
	} catch (error) {
		if (error?.code === 'ENOENT') return undefined;
		throw error;
	}
}

async function restoreDeployConfig(contents) {
	if (contents === undefined) {
		await rm(deployConfigPath, { force: true });
		return;
	}
	await mkdir(path.dirname(deployConfigPath), { recursive: true });
	await writeFile(deployConfigPath, contents);
}

function runStatsigBuild() {
	const vitePath = path.resolve('node_modules/.bin/vite');
	return new Promise((resolve, reject) => {
		const child = spawn(vitePath, ['build', '--config', 'vite.statsig.config.ts'], {
			env: {
				...process.env,
				WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? '/tmp/wrangler.log',
			},
			stdio: 'inherit',
		});
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (signal) {
				reject(new Error(`Statsig build terminated by ${signal}`));
				return;
			}
			resolve(code ?? 1);
		});
	});
}

const originalDeployConfig = await readCurrentDeployConfig();

try {
	const exitCode = await runStatsigBuild();
	if (exitCode !== 0) process.exitCode = exitCode;
} finally {
	await restoreDeployConfig(originalDeployConfig);
}
