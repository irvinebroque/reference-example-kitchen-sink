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
		<section className="panel">
			<p className="eyebrow">React Router action</p>
			<h1>POST through Express into framework mode</h1>
			<Form method="post" className="stack">
				<label>
					Message
					<input name="message" required maxLength={200} />
				</label>
				<button type="submit">Submit action</button>
			</Form>
			{result ? <pre>{JSON.stringify(result, null, 2)}</pre> : null}
		</section>
	);
}
