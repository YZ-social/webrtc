import process from 'node:process';
import cluster from 'node:cluster';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebRTC } from '../index.js';

// A minimal webrtc web portal server.
// Peers may POST signals to /join/<n> in order to connect (one at a time!) to a WebRTC node running at id <n>.
// Two such POSTs are typically required.
// The WebRTC does nothing except say 'Welcome!' on the data channel opened by the client.
// For a more complete example, see https://github.com/YZ-social/kdht/blob/main/spec/portal.js

const nPortals = parseInt(process.argv[2] || WebRTC.suggestedInstancesLimit);

if (cluster.isPrimary) { // Parent process with portal webserver through which clienta can bootstrap
  process.title = 'webrtc-test-portal';
  const app = express();  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  console.log('launching', nPortals, 'portals');
  for (let i = 0; i < nPortals; i++) {
    const worker = cluster.fork();
    worker.on('message', signals => { // Message from a worker, in response to a POST.
      worker.requestResolver?.(signals);
    });
  }
  const workers = Object.values(cluster.workers);
  app.use(express.json());
  app.use(express.static(path.resolve(__dirname, '..'))); // Serve files needed for testing browsers.
  app.post('/join/:to', async (req, res, next) => { // Handler for JSON POST requests that provide an array of signals and get signals back.
    const {params, body} = req;
    // Find the specifed worker, or pick one at random. TODO CLEANUP: Remove. We now use as separate /name/:label to pick one.
    const worker = workers[params.to];
    if (!worker) {
      console.warn('no worker', params.to);
      return res.sendStatus(404);
    }

    // Pass the POST body to the worker and await the response.
    const promise = new Promise(resolve => worker.requestResolver = resolve);
    worker.send(body, undefined, undefined, error =>
      error && console.log(`Error communicating with portal worker ${worker.id}:`, error));
    let response = await promise;
    delete worker.requestResolver; // Now that we have the response.

    return res.send(response);
  });
  app.listen(3000);
} else {
  process.title = 'webrtc-test-bot-' + cluster.worker.id;
  let portal;
  process.on('message', async incomingSignals => { // Signals from a sender through the server.
    const response = await portal.respond(incomingSignals);
    process.send(response);
  });
  function setup() {
    console.log(new Date(), 'launched bot', cluster.worker.id);
    portal = new WebRTC({name: 'portal'});
    portal.getDataChannelPromise('data').then(dc => dc.send('Welcome!'));
    portal.closed.then(setup); // Without any explicit message, this is 15 seconds after the other end goes away.
  }
  setup();
}
