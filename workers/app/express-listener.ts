import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

let currentHandler: RequestHandler = (_request, response) => {
	response.statusCode = 503;
	response.end('Express handler is warming up');
};

export const expressServer = createServer((request, response) => {
	currentHandler(request, response);
});

expressServer.listen(3000);

export function setExpressRequestHandler(handler: RequestHandler): void {
	currentHandler = handler;
}
