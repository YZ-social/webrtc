const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach} = globalThis; // For linters.
import { WebRTC } from '../index.js';

describe("WebRTC", function () {
  let A, B, bothOpen;
  describe("direct in-process signaling", function () {
    function makePair({debug = false} = {}) {
      const A = new WebRTC({name: "A (impolite)", polite: false, debug});
      const B = new WebRTC({name: "B (polite)", polite: true, debug});
      const aOpen = A.getDataChannelPromise('data').then(() => A.sendOn('data', `Hello from ${A.name}`));
      const bOpen = B.getDataChannelPromise('data').then(() => B.sendOn('data', `Hello from ${B.name}`));
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
      beforeAll(async function () {
	[A, B, bothOpen] = makePair();
	A.createChannel('data');
	await bothOpen;
      });
      standardBehavior(false);
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
	describe("impolite first", function () {
	  beforeAll(async function () {
	    [A, B, bothOpen] = makePair({debug: true});
	    A.createChannel("data");
	    B.createChannel("data");
	    await bothOpen;
	  });
	  standardBehavior();
	});
	describe("polite first", function () {
	  beforeAll(async function () {
	    [A, B, bothOpen] = makePair();
	    B.createChannel("data");
	    A.createChannel("data");
	    await bothOpen;
	  });
	  standardBehavior();
	});
      });
    });
  });
});
