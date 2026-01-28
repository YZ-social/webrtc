const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach} = globalThis; // For linters.
import { WebRTC } from '../index.js';

describe("WebRTC capacity", function () {
  let nNodes = 20; // When running all webrtc tests at once, it is important to keep this low. (Memory leak?)

  // Uncomment this line if running a stand-alone capacity test.
  // (And also likely comment out the import './webrtcSpec.js' in test.html.)
  nNodes = WebRTC.suggestedInstancesLimit;

  const isNodeJS = typeof(globalThis.process) !== 'undefined';
  let nodes = [];
  beforeAll(async function () {

    if (isNodeJS) {
      const { spawn } = await import('node:child_process');
      const path = await import('path');
      const { fileURLToPath } = await import('url');

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      function echo(data) { data = data.slice(0, -1); console.log(data.toString()); }
      const portalProcess = spawn('node', [path.resolve(__dirname, 'portal.js'), nNodes]);
      portalProcess.stdout.on('data', echo);
      portalProcess.stderr.on('data', echo);
      await new Promise(resolve => setTimeout(resolve, 6e3));
    }

    console.log(new Date(), 'creating', nNodes, 'nodes');
    for (let index = 0; index < nNodes; index++) {
      const node = nodes[index] = new WebRTC({name: 'node'});
      node.transferSignals = messages => fetch(`http://localhost:3000/join/${index}`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
	body: JSON.stringify(messages)
      }).then(response => response.json());
      node.closed.then(() => console.log('closed', index)); // Just for debugging.
      const dataOpened = node.getDataChannelPromise('data')
	    .then(dc => node.dataReceived = new Promise(resolve => dc.onmessage = event => resolve(event.data)));
      node.createChannel('data', {negotiated: false});      
      await dataOpened;
      console.log('opened', index);
    }
    console.log(new Date(), 'finished setup');
  }, Math.max(20e3, nNodes * (500 + 300)));
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
    if (isNodeJS) {
      const { exec } = await import('node:child_process');      
      exec('pkill webrtc-test-');
    }
  });
});
