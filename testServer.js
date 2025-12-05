import express from 'express';
import http from 'http';
import { router } from './routes/index.js';

process.title = 'webrtcTestServer';
export const app = express();
const port = 3000;
app.set('port', port);

app.use(express.json());
app.use('/test', router);

app.listen(port);

