import { RouterContextProvider, type LoaderFunctionArgs } from 'react-router';
import { describe, expect, it } from 'vitest';
import { requestContext } from '../../app/context';
import { loader } from '../../app/routes/protected';

function loaderArgs(context: RouterContextProvider): LoaderFunctionArgs {
	const request = new Request('http://localhost/protected');
	return {
		context,
		params: {},
		pattern: '/protected',
		request,
		url: new URL(request.url),
	};
}

describe('protected route', () => {
	it('redirects before requesting features for unauthenticated users', async () => {
		let featureRequests = 0;
		const context = new RouterContextProvider();
		context.set(requestContext, {
			app: {
				applicationId: 'test-app',
				environment: 'test',
				version: 'test',
			},
			async getFeatures() {
				featureRequests += 1;
				return null;
			},
			session: null,
		});

		let thrown: unknown;
		try {
			await loader(loaderArgs(context));
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Response);
		if (!(thrown instanceof Response)) throw new TypeError('Expected a redirect response');
		expect(thrown.status).toBe(302);
		expect(thrown.headers.get('location')).toBe('/api/auth/signin?callbackUrl=/protected');
		expect(thrown.headers.get('x-remix-reload-document')).toBe('true');
		expect(featureRequests).toBe(0);
	});
});
