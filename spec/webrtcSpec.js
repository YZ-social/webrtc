const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach} = globalThis; // For linters.
import { WebRTC, PromiseWebRTC } from '../index.js';

class DirectSignaling extends WebRTC {
  signal(type, message) { // Just invoke the method directly on the otherSide.
    this.otherSide[type](message);
  }
  signals = [];
}
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('basic connection between two peers on the same computer', function () {
  function test(Kind) {
    describe(Kind.name, function () {
      let a = {}, b = {};
      const channelName = 'test';
      const channelOptions = {};
      beforeAll(async function () {
	a.connection = Kind.ensure({serviceLabel: 'A'});
	b.connection = Kind.ensure({serviceLabel: 'B'});

	// Required for DirectSignaling signal(), above. Ignored for PromiseWebRTC.
	a.connection.otherSide = b.connection;
	b.connection.otherSide = a.connection;    

	a.dataChannelPromise = a.connection.ensureDataChannel(channelName, channelOptions);
	const aSignals = await a.connection.signals; // Empty list for direct signaling.

	// The second peer on the initial negotiation must specify a non-empty signals --
	// either an empty list for trickle-ice, or a list of the actual signals from the PromiseWebRTC.
	b.dataChannelPromise = b.connection.ensureDataChannel(channelName, channelOptions, aSignals);
	const bSignals = await b.connection.signals;

	a.connection.signals = bSignals;
	a.testChannel = await a.dataChannelPromise;
	b.testChannel = await b.dataChannelPromise;
	await a.connection.reportConnection(true);
	await b.connection.reportConnection(true);
      });
      afterAll(async function () {
	a.connection.close();
	expect(a.connection.peer.connectionState).toBe('new');
	await delay(10); // Yield to allow the other side to close.
	expect(b.connection.peer.connectionState).toBe('new');
	await delay(1e3); // between tests.
      });
      it("changes state appropriately.", async function () {
	expect(await a.dataChannelPromise).toBeTruthy();
	expect(await b.dataChannelPromise).toBeTruthy();
	expect(a.connection.peer.connectionState).toBe('connected');
	expect(b.connection.peer.connectionState).toBe('connected');
	// In this case, since both are on the same machine:
	expect(a.connection.protocol).toBe(b.connection.protocol);
	expect(a.connection.protocol).toBe('udp');
	expect(a.connection.candidateType).toBe(b.connection.candidateType);
	expect(a.connection.candidateType).toBe('host');
      });
      it("sends data over raw channel.", async function () {
	const aReceived = new Promise(resolve => a.testChannel.onmessage = event => resolve(event.data));
	const bReceived = new Promise(resolve => b.testChannel.onmessage = event => resolve(event.data));
	a.testChannel.send("forty-two");
	b.testChannel.send("17");
	expect(await aReceived).toBe("17");
	expect(await bReceived).toBe("forty-two");
      });
      describe("second channel", function () {
	beforeAll(async function () {
	  const name2 = 'channel2';
	  a.promise2 = a.connection.ensureDataChannel(name2, channelOptions);
	  b.promise2 = b.connection.ensureDataChannel(name2, channelOptions);
	  a.channel2 = await a.promise2;
	  b.channel2 = await b.promise2;
	});
	afterAll(async function () {
	  a.channel2.close();
	});
	it("handles data.", async function () {
	  const aReceived = new Promise(resolve => a.channel2.onmessage = event => resolve(event.data));
	  const bReceived = new Promise(resolve => b.channel2.onmessage = event => resolve(event.data));
	  a.channel2.send("red");
	  b.channel2.send("blue");
	  expect(await aReceived).toBe("blue");
	  expect(await bReceived).toBe("red");
	}, 10e3);
      });
    });
  }
  test(DirectSignaling);
  test(PromiseWebRTC);
});
