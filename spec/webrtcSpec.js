const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach} = globalThis; // For linters.
import { WebRTC, PromiseWebRTC, TrickleWebRTC } from '../index.js';

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

describe("WebRTC", function () {
  describe("connection to server", function () {
    describe("using PromiseWebRTC", function () {
      let connection, dataChannel;
      beforeAll(async function () {
	connection = PromiseWebRTC.ensure({serviceLabel: 'PromiseClient'});
	const dataChannelPromise = connection.ensureDataChannel('echo');
	connection.signals = await fetchSignals("http://localhost:3000/test/promise/echo/foo", await connection.signals);
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

	  console.log('client sending', map(sending));
	  const returning = await fetchSignals("http://localhost:3000/test/trickle/echo/foo", sending);

	  if (!returning?.length) return;
	  //if (a.connection.peer.iceGatheringState !== 'gathering') return;
	  console.log('client', 'received', map(returning), connection.peer.iceGatheringState);
	  connection.signals = returning;
	  exchange();
	}
	exchange();
	
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

  describe('connection between two peers on the same computer', function () {
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
	  //console.log(Kind.name, 'aSignals:', map(aSignals));

	  // The second peer on the initial negotiation must specify a non-empty signals --
	  // either an empty list for trickle-ice, or a list of the actual signals from the PromiseWebRTC.

	  b.next = b.connection.signals;
	  // let bPromise = b.connection.signals;
	  // aPromise = a.connection.signals;
	  b.dataChannelPromise = b.connection.ensureDataChannel(channelName, channelOptions, aSignals);
	  // const bSignals = await bPromise;
	  // console.log(Kind.name, 'bSignals:', map(bSignals));

	  // bPromise = b.connection.signals;
	  // a.connection.signals = bSignals;

	  async function exchange() {
	    if (a.connection.peer.iceGatheringState !== 'gathering') return;
	    const sending = a.connection.sending;
	    a.connection.sending = [];

	    console.log(Kind.name, 'sending', map(sending), b.connection.peer.iceGatheringState);
	    b.connection.signals = sending;
	    const returning = await Promise.race([b.next, b.dataChannelPromise]);
	    b.next = b.connection.signals;

	    if (!returning?.length) return;
	    //if (a.connection.peer.iceGatheringState !== 'gathering') return;
	    console.log(Kind.name, 'received', map(returning), a.connection.peer.iceGatheringState);
	    a.connection.signals = returning;
	    exchange();
	  }
	  exchange();

	  // Only needed in the trickle ice case. Harmless otherwise.
	  async function conveySignals(from, to, promise) {
	    const state = from.peer.iceGatheringState;
	    if (state !== 'gathering') {
	      console.log(Kind.name, from.label, state, 'skipping');
	      return;
	    }
	    console.log(Kind.name, from.label, state, from.peer.iceConnectionState, from.peer.connectionState, from.peer.signalingState, 'waiting');
	    const signals = await Promise.race([promise,
						from === a.connection ? a.dataChannelPromise : b.dataChannelPromise,
					       ]); // 7     |      f
	    console.log(Kind.name, from.label, 'resolved:', map(signals));
	    const next = from.signals;     // 8     |      g
	    if (!signals?.length) return;
	    to.signals = signals;          // d     |       h
	    conveySignals(from, to, next);
	  }
	  // conveySignals(a.connection, b.connection, aNext); //6.5
	  // conveySignals(b.connection, a.connection, bNext);

	  async function push() { // Await signals in a and send them to b.
	    if (a.connection.peer.iceGatheringState !== 'gathering') return;
	    const signals = await Promise.race([aPromise, a.dataChannelPromise]);
	    aPromise = a.connection.signals;
	    if (!signals.length) return;
	    console.log(Kind.name, 'pushing', map(signals));
	    b.connection.signals = signals;
	    push();
	  }
	  async function pull(promise) { // Request signals from b, setting whatever we get.
	    if (a.connection.peer.iceGatheringState !== 'gathering') return;	    
	    const signals = await Promise.race([bPromise, b.dataChannelPromise]);
	    bPromise = b.connection.signals;
	    if (!signals.length) return;
	    console.log(Kind.name, 'pulling', map(signals));
	    a.connection.signals = signals;
	    pull();
	  }
	  //push();
	  //pull();
	  
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
    test(PromiseWebRTC);
    test(TrickleWebRTC);
  });
});
