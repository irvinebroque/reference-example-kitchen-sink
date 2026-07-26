import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createServer } from 'node:http';
import { createApp } from './create-app';

const server = createServer(createApp(env as Env));
server.listen(3000);

export default httpServerHandler({ port: 3000 });
