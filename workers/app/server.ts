import { env } from 'cloudflare:workers';
import { createApp } from './create-app';

export default createApp(env);
