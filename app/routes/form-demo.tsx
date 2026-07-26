import { Button } from '@cloudflare/kumo/components/button';
import { Input } from '@cloudflare/kumo/components/input';
import { LayerCard } from '@cloudflare/kumo/components/layer-card';
import { Text } from '@cloudflare/kumo/components/text';
import { Form, useActionData, type ActionFunctionArgs } from 'react-router';

export async function action({ request }: ActionFunctionArgs) {
	const form = await request.formData();
	return {
		message: String(form.get('message') ?? '').slice(0, 200),
		receivedAt: new Date().toISOString(),
	};
}

export default function FormDemo() {
	const result = useActionData<typeof action>();
	return (
		<div className="page-shell narrow">
			<section className="page-heading">
				<div className="heading-copy">
					<Text variant="heading1" as="h1">
						Form action
					</Text>
					<Text variant="secondary">Post a message through the native Fetch handler into React Router framework mode.</Text>
				</div>
			</section>

			<LayerCard className="content-card">
				<Form method="post" className="form-stack">
					<Input label="Message" name="message" required maxLength={200} />
					<Button type="submit" variant="primary">
						Submit
					</Button>
				</Form>
				{result ? (
					<div className="result">
						<Text variant="heading3" as="h2">
							Response
						</Text>
						<pre>{JSON.stringify(result, null, 2)}</pre>
					</div>
				) : null}
			</LayerCard>
		</div>
	);
}
