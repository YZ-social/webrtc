const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach} = globalThis; // For linters.
import { WebRTC, WebRTCBase } from '../index.js';

class DirectSignaling extends WebRTCBase {
  signal(type, message) { // Just invoke the method directly on the otherSide.
    this.otherSide[type](message);
  }
  signals = [];
}
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
async function fetchSignals(url, signalsToSend) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signalsToSend)
  });
  return await response.json();
}

describe("WebRTC", function () {
	
  describe("connection between two peers on the same computer", function () {
    const channelName = 'test';
    function test(Kind, connect) {
      describe(Kind.name, function () {
	let a = {}, b = {}; let calledCloseA = 0, calledCloseB = 0;
	beforeAll(async function () {
	  const debug = false;
	  a.connection = Kind.ensure({serviceLabel: 'A'+Kind.name, debug});
	  b.connection = Kind.ensure({serviceLabel: 'B'+Kind.name, debug});

	  await connect(a, b);

	  a.testChannel = await a.dataChannelPromise;
	  b.testChannel = await b.dataChannelPromise;
	  a.testChannel.addEventListener('close', () => { calledCloseA++; });
	  b.testChannel.addEventListener('close', () => { calledCloseB++; });

	  await a.connection.reportConnection();
	  await b.connection.reportConnection();
	});
	afterAll(async function () {
	  a.connection.close();
	  expect(a.connection.peer.connectionState).toBe('new');
	  await delay(10); // Yield to allow the other side to close.
	  expect(b.connection.peer.connectionState).toBe('new');
	  expect(calledCloseA).toBe(1);
	  expect(calledCloseB).toBe(1);
	});
	it("changes state appropriately.", async function () {
	  expect(await a.dataChannelPromise).toBeTruthy();
	  expect(await b.dataChannelPromise).toBeTruthy();
	  expect(a.connection.peer.connectionState).toBe('connected');
	  expect(b.connection.peer.connectionState).toBe('connected');
	  expect(a.connection.protocol).toBe(b.connection.protocol);
	  expect(a.connection.protocol).toBe('udp');
	  // In this case, since both are on the same machine:
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
	    a.promise2 = a.connection.ensureDataChannel(name2);
	    b.promise2 = b.connection.ensureDataChannel(name2);
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
    test(DirectSignaling, async (a, b) => {
      a.connection.otherSide = b.connection;
      b.connection.otherSide = a.connection;
      a.dataChannelPromise = a.connection.ensureDataChannel(channelName);
      // Give the other side an empty list of signals (else we get two offers and no answer),
      // but yield for the a's offer to be directly transmitted.
      b.dataChannelPromise = b.connection.ensureDataChannel(channelName, {}, await []);
    });
    test(WebRTC, async (a, b) => {
      a.dataChannelPromise = a.connection.ensureDataChannel(channelName);
      await a.connection.signalsReady; // await for offer
      b.dataChannelPromise = b.connection.ensureDataChannel(channelName, {}, a.connection.signals);
      await b.connection.signalsReady; // await answer
      await a.connection.connectVia(signals => b.connection.respond(signals)); // Transmits signals back and forth.
    });
  });
  
  describe("connection to server", function () {
    describe("using NG ICE", function () {
      let connection, dataChannel;
      beforeAll(async function () {
	connection = WebRTC.ensure({serviceLabel: 'Client'});
	const ready = connection.signalsReady;
	const dataChannelPromise = connection.ensureDataChannel('echo');
	await ready;
	connection.connectVia(signals => fetchSignals("http://localhost:3000/test/data/echo/foo", signals));
	dataChannel = await dataChannelPromise;
      });
      afterAll(function () {
	connection.close();
      });
      it("sends and receives data", async function () {
	const echoPromise = new Promise(resolve => dataChannel.onmessage = event => resolve(event.data));
	dataChannel.send('hello');
	expect(await echoPromise).toBe('hello');
      });
    });
  });

  describe("capacity", function () {
    const pairs = [];
    const nPairs = 76; // NodeJS fails after 152 webrtc peers (76 pairs) in series. In parallel, it is only up through 67 pairs.
    beforeAll(async function () {
      const promises = [];
      for (let i = 0; i < nPairs; i++) {
	const a = {}, b = {};
	a.connection = new WebRTC({label: `initiator-${i}`});
	b.connection = new WebRTC({label: `receiver-${i}`});
	let aPromise = a.connection.signalsReady;
	a.dataChannelPromise = a.connection.ensureDataChannel('capacity');
	const aSignals = await aPromise;
	await a.connection.connectVia(signals => b.connection.respond(signals))
	  .then(() => pairs.push([a, b]));
      }
      await Promise.all(promises);
    });
    afterAll(async function () {
      for (const [a] of pairs) a.connection.close();
      await delay(2e3);
    });
    it("is pretty big.", function () {
      expect(pairs.length).toBe(nPairs);
    });
  });
});
