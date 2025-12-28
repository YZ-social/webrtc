const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach} = globalThis; // For linters.
import { WebRTC } from '../index.js';

describe("WebRTC", function () {
  let A, B, bothOpen;
  describe("direct in-process signaling", function () {
    function makePair({debug = false, delay = 0} = {}) {
      const A = new WebRTC({name: "A (impolite)", polite: false, debug});
      const B = new WebRTC({name: "B (polite)", polite: true, debug});
      async function sendingSetup(dc) {
	const webrtc = dc.webrtc;
	webrtc.receivedMessageCount = webrtc.sentMessageCount = 0;
	dc.onmessage = e => {
	  webrtc.receivedMessageCount++;
	  webrtc.log('got message on', dc.label, dc.id, e.data);
	};
	webrtc.sentMessageCount++;

	// Subtle:
	//
	// An explicit createChannel() arranges for the promise created by getDataChannelPromise() of the same name to
	// resolve on that side of the connection when the channel is open. The other side will internally receive a
	// datachannel event and we arrange for that side to then also resolve a getDataChannelPromise for that name.
	//
	// If only wide side creates the channel, things work out smoothly. Each side ends up resolving the promise for a
	// channel of the given name. The id is as defaulted or specified if negotiated:true, else an internally determined
	// unique id is used.
	//
	// Things are also smooth if negotiated:true and both sides call createChannel simultaneously, such that there
	// are overlappaing offers. One side backs down and there ends up being one channel with the specified id. (The default
	// id will be the same on both sides IFF any multiple data channels are created in the same order on both sides.)
	//
	// However, when negotiated:false, and both sides call createChannel simultaneously, things get complex. Counterintuitively,
	// RTCPeerConnection arranges for the internall determined id to be unique between the two sides, so both get
	// two channels with the same name and different id. There will be two internal open events on each side: first for the
	// channel that it created, and second for one that the other side created. There isn't any reason to do this (as
	// opposed to specifying negotiated:true, unless the application needs each side to listen on one channel and send
	// on the other. However, getDataChannelPromise return a promise based on the specified name alone, and it only
	// resolves once. For compatibility with the single-sided case, we resolve the first channel (on each side, which
	// are different ids). Thus we must attach onmessage to one channel and send on the other. On both sides, the
	// first channel is what the promise resolves to, but after a delay, the second channel is available on webrtc[channelName].

	if (!delay) return dc.send(`Hello from ${webrtc.name}`);
	await WebRTC.delay(delay);
	webrtc.data.send(`Hello from ${webrtc.name}`);
	return null;
      }
      const aOpen = A.getDataChannelPromise('data').then(sendingSetup);
      const bOpen = B.getDataChannelPromise('data').then(sendingSetup);
      A.signal = msg => B.onSignal(msg);
      B.signal = msg => A.onSignal(msg);
      return [A, B, Promise.all([aOpen, bOpen])];
    }
    function standardBehavior(includeConflictCheck = (typeof(process) === 'undefined')) {
      it("connects.", function () {
	expect(A.data.readyState).toBe('open');
	expect(B.data.readyState).toBe('open');
      });
      it("receives.", async function () {
	await WebRTC.delay(100); // Allow time to receive.
	expect(A.sentMessageCount).toBe(B.receivedMessageCount);
	expect(B.sentMessageCount).toBe(A.receivedMessageCount);
      });
      it("learns of one open.", function () {
	expect(A.sentMessageCount).toBe(1);
	expect(B.sentMessageCount).toBe(1);
      });
      if (includeConflictCheck) {
	it("politely ignores a conflict.", function () {
	  expect(A.rolledBack).toBeFalsy();
	  expect(B.rolledBack).toBeTruthy(); // timing dependent, but useful for debugging
	});
      }
      afterAll(async function () {
	await A.close();
	expect(A.data.readyState).toBe('closed');
	await B.close();
	expect(B.data.readyState).toBe('closed');
      });
    }
    describe("one side opens", function () {
      describe('non-negotiated', function () {
	beforeAll(async function () {
	  [A, B, bothOpen] = makePair();
	  A.createChannel('data', {negotiated: false});
	  await bothOpen;
	});
	standardBehavior(false);
      });
      describe('negotiated on on first signal', function () {
	beforeAll(async function () {
	  [A, B, bothOpen] = makePair();
	  // There isn't really a direct, automated way to have one side open another with negotiated:true,
	  // because the receiving RTCPeerConnection does not fire 'datachannel' when the sender was negotiated:true.
	  // However, what the app can do is wake up and create an explicit createChannel when it first receives an
	  // unsolicited offer. 
	  let awake = false;
	  A.signal = msg => {
	    if (!awake) {
	      B.createChannel("data", {negotiated: true});
	      awake = true;
	    }
	    B.onSignal(msg);
	  };
	  A.createChannel('data', {negotiated: true});
	  await bothOpen;
	});
	standardBehavior(false);
      });
    });

    describe("simultaneous two-sided", function () {
      describe("negotiated single full-duplex-channel", function () {
	describe("impolite first", function () {
	  beforeAll(async function () {
	    [A, B, bothOpen] = makePair();	    
	    A.createChannel("data", {negotiated: true});
	    B.createChannel("data", {negotiated: true});
	    await bothOpen;
	  });
	  standardBehavior();
	});
	describe("polite first", function () {
	  beforeAll(async function () {
	    [A, B, bothOpen] = makePair();
	    B.createChannel("data", {negotiated: true});
	    A.createChannel("data", {negotiated: true});
	    await bothOpen;
	  });
	  standardBehavior();
	});
      });
      describe("non-negotiated dual half-duplex channels", function () {
	const delay = 10;
	describe("impolite first", function () {
	  beforeAll(async function () {
	    [A, B, bothOpen] = makePair({delay});
	    A.createChannel("data", {negotiated: false});
	    B.createChannel("data", {negotiated: false});
	    await bothOpen;
	  });
	  standardBehavior();
	});
	describe("polite first", function () {
	  beforeAll(async function () {
	    [A, B, bothOpen] = makePair({delay});
	    B.createChannel("data", {negotiated: false});
	    A.createChannel("data", {negotiated: false});
	    await bothOpen;
	  });
	  standardBehavior();
	});
      });
    });
  });
});
