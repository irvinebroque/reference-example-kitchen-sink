export class CookieJar {
	absorb(headers: Headers): void;
	header(): string;
	has(name: string): boolean;
}

export function getSetCookies(headers: Headers): string[];

export function assertSameOriginRedirect(response: Response, origin: string, label: string): URL;

export interface ReadinessOptions {
	attempts?: number;
	fetchImplementation?: typeof fetch;
	origin: string;
	sleep?: (milliseconds: number) => Promise<void>;
	timeoutMs?: number;
}

export function waitForReadiness(options: ReadinessOptions): Promise<void>;

export interface SmokeOptions {
	attempts?: number;
	fetchImplementation?: typeof fetch;
	sleep?: (milliseconds: number) => Promise<void>;
	targetUrl: string;
	timeoutMs?: number;
}

export function runPreviewAuthSmoke(options: SmokeOptions): Promise<void>;

export function smokeConfiguration(environment?: NodeJS.ProcessEnv): {
	attempts: number;
	timeoutMs: number;
};
