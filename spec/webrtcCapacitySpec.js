const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach} = globalThis; // For linters.
import { WebRTC } from '../index.js';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe("WebRTC capacity", function () {
  let nNodes = 20; // When running all webrtc tests at once, it is important to keep this low. (Memory leak?)
  let perPortalDelay = 1e3;
  let port = 3000;
  let baseURL = `http://localhost:${port}`;
  // Alas, I can't seem to get more than about 150-160 nodes through ngrok, even on a machine that can handle 200 directly.
  //let baseURL = 'https://dorado.ngrok.dev'; // if E.g., node spec/portal.js 200 100; ngrok http 3000 --url https://dorado.ngrok.dev

  // Uncomment this line if running a stand-alone capacity test.
  // (And also likely comment out the import './webrtcSpec.js' in test.html.)
  // nNodes = WebRTC.suggestedInstancesLimit;

  const isNodeJS = typeof(globalThis.process) !== 'undefined';
  const portalIsLocal = isNodeJS && baseURL.startsWith('http://localhost');
  let nodes = [];
  beforeAll(async function () {

    if (portalIsLocal) {
      const { spawn } = await import('node:child_process');
      const path = await import('path');
      const { fileURLToPath } = await import('url');

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      function echo(data) { data = data.slice(0, -1); console.log(data.toString()); }
      const portalProcess = spawn('node', [path.resolve(__dirname, 'portal.js'), nNodes, perPortalDelay, port]);
      portalProcess.stdout.on('data', echo);
      portalProcess.stderr.on('data', echo);
      await delay(perPortalDelay * (5 + nNodes));
    }

    console.log(new Date(), 'creating', nNodes, 'nodes');
    for (let index = 0; index < nNodes; index++) {
      const node = nodes[index] = new WebRTC({name: 'node' + index});
      console.log('connecting', index);
      node.transferSignals = messages => fetch(`${baseURL}/join/${index}`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
	body: JSON.stringify(messages)
      }).then(response => {
	if (!response.ok) {
	  console.log('fetch', index, 'failed', response.status, response.statusText);
	  return null;
	}
	return response.json();
      });
      node.closed.then(() => console.log('closed', index)); // Just for debugging.
      const dataOpened = node.getDataChannelPromise('data')
	    .then(dc => node.dataReceived = new Promise(resolve => dc.onmessage = event => resolve(event.data)));
      node.createChannel('data', {negotiated: false});
      await dataOpened;
      console.log('opened', index);
      if (!portalIsLocal) {
	const maxConnectionsPerNode = 3;
	const maxNgrokConnectionsPerSecond = 120 / 60;
	const secondsPerNode = maxConnectionsPerNode / maxNgrokConnectionsPerSecond;
	await delay(secondsPerNode * 1.5e3); // fudge factor milliseconds/second
      }
    }
    console.log(new Date(), 'finished setup');
  }, nNodes * 4 * perPortalDelay);
  for (let index = 0; index < nNodes; index++) {
    it('opened connection ' + index, function () {      
      expect(nodes[index].pc.connectionState).toBe('connected');
    });
    it('got data ' + index, async function () {
      expect(await nodes[index].dataReceived).toBe('Welcome!');
    });
  }
  afterAll(async function () {
    console.log(new Date(), 'starting teardown');
    for (let index = 0; index < nNodes; index++) {
      const node = nodes[index];
      expect(node.pc.connectionState).toBe('connected');
      await node.close().then(pc =>
	expect(pc.connectionState).toBe('closed'));
      delete nodes[index];
    }
    if (portalIsLocal) {
      const { exec } = await import('node:child_process');      
      exec('pkill webrtc-test-');
    }
  });
});
