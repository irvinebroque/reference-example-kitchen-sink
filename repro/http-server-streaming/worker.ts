import { httpServerHandler } from 'cloudflare:node';
import { streamingServer } from './server';

streamingServer.listen(8080);

export default httpServerHandler({ port: 8080 });
