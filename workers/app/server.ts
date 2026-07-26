import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createApp } from './create-app';
import { expressServer, setExpressRequestHandler } from './express-listener';

setExpressRequestHandler(createApp(env as Env));

export default httpServerHandler({ port: 3000 });
