const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach} = globalThis; // For linters.
import { WebRTC, PromiseWebRTC, TrickleWebRTC } from '../index.js';
import { WebRTCNG } from '../lib/webrtcng.js';

class DirectSignaling extends WebRTC {
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
function map(signals) { return signals?.map?.(s => s[0]); }
async function exchange(aConnection, bConnection, bDataChannelPromise) {
  if (aConnection.peer.iceGatheringState !== 'gathering') return;
  const sending = aConnection.sending;
  aConnection.sending = [];

  bConnection.signals = sending;
  const returning = await Promise.race([bConnection.next, bDataChannelPromise]);
  bConnection.next = bConnection.signals;

  if (!returning?.length) return;
  aConnection.signals = returning;
  exchange(aConnection, bConnection, bDataChannelPromise);
}

describe("WebRTC", function () {
  describe("connection to server", function () {
    describe("using PromiseWebRTC", function () {
      let connection, dataChannel;
      beforeAll(async function () {
	connection = PromiseWebRTC.ensure({serviceLabel: 'PromiseClient'});
	const dataChannelPromise = connection.ensureDataChannel('echo');
	connection.signals = await fetchSignals("http://localhost:3000/test/promise/echo/foo", await connection.signals);
	dataChannel = await dataChannelPromise;
	//connection.reportConnection(true);
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
    describe("using trickle ICE", function () {
      let connection, dataChannel;
      beforeAll(async function () {
	connection = TrickleWebRTC.ensure({serviceLabel: 'Client'});
	const dataChannelPromise = connection.ensureDataChannel('echo');
	await connection.signals;
	async function exchange() {
	  if (connection.peer.iceGatheringState !== 'gathering') return;
	  const sending = connection.sending;
	  connection.sending = [];

	  //console.log('client sending', map(sending));
	  const returning = await fetchSignals("http://localhost:3000/test/trickle/echo/foo", sending);

	  if (!returning?.length) return;
	  //console.log('client', 'received', map(returning), connection.peer.iceGatheringState);
	  connection.signals = returning;
	  exchange();
	}
	exchange();
	
	dataChannel = await dataChannelPromise;
	//connection.reportConnection(true);
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
    describe("using NG ICE", function () {
      let connection, dataChannel;
      beforeAll(async function () {
	connection = WebRTCNG.ensure({serviceLabel: 'Client'});
	const ready = connection.signalsReady;
	const dataChannelPromise = connection.ensureDataChannel('echo');
	await ready;
	connection.connectVia(signals => fetchSignals("http://localhost:3000/test/data/echo/foo", signals));
	dataChannel = await dataChannelPromise;
	connection.reportConnection(true);
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
	a.connection = new WebRTCNG({label: `initiator-${i}`});
	b.connection = new WebRTCNG({label: `receiver-${i}`});
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
      console.log('created', pairs.length);
      expect(pairs.length).toBe(nPairs);
    });
  });
	
  describe("connection between two peers on the same computer", function () {
    function test(Kind) {
      describe(Kind.name, function () {
	let a = {}, b = {};
	const channelName = 'test';
	const channelOptions = {};
	beforeAll(async function () {
	  const debug = false;
	  a.connection = Kind.ensure({serviceLabel: 'A'+Kind.name, debug});
	  b.connection = Kind.ensure({serviceLabel: 'B'+Kind.name, debug});

	  // Required only for DirectSignaling signal(), above. Ignored for others.
	  a.connection.otherSide = b.connection;
	  b.connection.otherSide = a.connection;    

	  let aPromise = a.connection.signals;
	  a.dataChannelPromise = a.connection.ensureDataChannel(channelName, channelOptions);
	  const aSignals = await aPromise;
	  a.connection.sending = [];
	  b.connection.next = b.connection.signals;
	  b.dataChannelPromise = b.connection.ensureDataChannel(channelName, channelOptions, aSignals);

	  exchange(a.connection, b.connection, b.dataChannelPromise);

	  a.testChannel = await a.dataChannelPromise;
	  b.testChannel = await b.dataChannelPromise;

	  await a.connection.reportConnection();
	  await b.connection.reportConnection();
	});
	afterAll(async function () {
	  a.connection.close();
	  expect(a.connection.peer.connectionState).toBe('new');
	  await delay(10); // Yield to allow the other side to close.
	  expect(b.connection.peer.connectionState).toBe('new');
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
    //test(PromiseWebRTC);
    test(TrickleWebRTC);
  });
});
