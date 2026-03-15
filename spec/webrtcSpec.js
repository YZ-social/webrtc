const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach} = globalThis; // For linters.
import { WebRTC } from '../index.js';

describe("WebRTC", function () {
  const isBrowser = typeof(process) === 'undefined';
  let connections = [];
  describe("direct in-process signaling", function () {
    async function makePair({debug = false, delay = 0, index = 0} = {}) {
      // Make a pair of WebRTC objects (in the same Javascript process) that transfer signals to each other by calling
      // respond(signals) on the other of the pair. In a real application, the WebRTC instances would be in different
      // processes (likely on different devices) and transferSignals would instead involve some sort of InterProcess
      // Communication or network call, ultimately resulting in the same respond(signals) being called on the other
      // end, and the resulting signals being transferred back.
      //
      // connections[index] will contain {A, B, bothOpen}, where A and B are the two WebRTC, and bothOpen resolves
      // when A and B are both open (regardless of how they were triggered, which is different for each test).
      // We also annotate the WebRTC with various flags used in the test, and arranges to set those when the channel
      // named 'data' is opened.
      const configuration = { iceServers: WebRTC.iceServers };
      const A = new WebRTC({name: `A (impolite) ${index}`, polite: false, debug, configuration});
      const B = new WebRTC({name: `B (polite) ${index}`, polite: true, debug, configuration});
        // Subtle:
        //
        // An explicit createChannel() arranges for the promise created by getDataChannelPromise() of the same name to
        // resolve on that side of the connection when the channel is open. The other side will internally receive a
        // datachannel event and we arrange for that side to then also resolve a getDataChannelPromise for that name.
        //
        // If only one side creates the channel, things work out smoothly. Each side ends up resolving the promise for a
        // channel of the given name. The id is as defaulted or specified if negotiated:true, else an internally determined
        // unique id is used.
        //
        // Things are also smooth if negotiated:true and both sides call createChannel simultaneously, such that there
        // are overlappaing offers. One side backs down and there ends up being one channel with the specified id. (The default
        // id will be the same on both sides IFF any multiple data channels are created in the same order on both sides.)
        //
        // However, when negotiated:FALSE, and both sides call createChannel with a delay in betwen, things get complex. Counterintuitively,
        // RTCPeerConnection arranges for the internally determined id to be unique between the two sides, so both get
        // two channels with the same name and different id. There will be two internal open events on each side: first for the
        // channel that it created, and second for one that the other side created. (There likely isn't any reason to do this, as
        // opposed to specifying negotiated:true, unless the application needs each side to listen on one channel and send
        // on the other.)
      async function receivingSetup(dc) {
        const webrtc = dc.webrtc;
        webrtc.log('got open recieving channel', dc.label, dc.id);
	webrtc.ours = dc;
	webrtc.receivedMessageCount = 0;
	webrtc.gotData = new Promise(resolve => webrtc.gotDataResolver = resolve);
        dc.onmessage = e => {
          webrtc.receivedMessageCount++;
          webrtc.log('got message on', dc.label, dc.id, e.data);
	  webrtc.gotDataResolver(e.data);
	};
	return dc;
      }
      async function sendingSetup(dc) {
        const webrtc = dc.webrtc;
	webrtc.log('got open sending channel', dc.label, dc.id);
	webrtc.theirs = dc;
        webrtc.sentMessageCount ||= 0;
	webrtc.sentMessageCount++;
        await WebRTC.delay(delay);
	dc.send(`Hello from ${webrtc.name}`);
	return dc;
      }
      const promises = [];
      if (!delay) {
	promises.push(A.getDataChannelPromise('data').then(receivingSetup).then(sendingSetup));
	promises.push(B.getDataChannelPromise('data').then(receivingSetup).then(sendingSetup));
      } else {
	promises.push(A.getDataChannelPromise('data', 'Ours').then(receivingSetup));
	promises.push(B.getDataChannelPromise('data', 'Ours').then(receivingSetup));
	promises.push(A.getDataChannelPromise('data', 'Theirs').then(sendingSetup));
	promises.push(B.getDataChannelPromise('data', 'Theirs').then(sendingSetup));
      }
	
      const direct = false; // Does signal work direct/one-sided to the other? False makes a request that waits for a response.
      if (direct) {
	A.signal = message => B.onSignal(message);
	B.signal = message => A.onSignal(message);
      } else {
	A.transferSignals = messages => B.respond(messages);
	B.transferSignals = messages => A.respond(messages);
      }
      await WebRTC.delay(1); // TODO: This is crazy, but without out, the FIRST connection in chrome hangs!
      return connections[index] = {A, B, bothOpen: Promise.all(promises)};
    }
    function standardBehavior(setup, {includeConflictCheck = isBrowser, includeSecondChannel = false, reneg = true} = {}) {
      // Defines a set of tests, intended to be within a suite.
      // A beforeAll is created which calls the given setup({index}) nPairs times. setup() is expected to makePair and
      // open the data channel in some suite-specific way.

      // The nPairs does NOT seem to be a reliable way to determine how many webrtc peers can be active in the same Javascript.
      // I have had numbers that work for every one of the cases DESCRIBEd below, and even in combinations,      
      // but it seems to get upset when all are run together, and it seemms to depend on the state of the machine or phases of the moon.
      // When it fails, it just locks up with no indication of what is happening.
      // Maybe a memory / memory-leak issue?
      //
      // Some observed behaviors, at some point in time, include:
      // 1 channel pair, without negotiated on first signal: nodejs:83, firefox:150+, safari:85+ but gets confused with closing, chrome/edge:50(?)
      // 50 works across the board with one channel pair
      // On Safari (only), anything more than 32 pair starts to loose messages on the SECOND channel.
      // In NodeJS with includeSecondChannel: 32
      // In NodeJS witout includeSecondChannel: 62, 75, even 85, but not consistently.
      //
      // webrtcCapacitySpec.js may be a better test for capacity.
      const nPairs = 10;

      beforeAll(async function () {
        const start = Date.now();
        console.log(new Date(), 'start setup', nPairs, 'pairs');
        for (let index = 0; index < nPairs; index++) {
	  console.log('setup', index);
          await setup({index});
        }
	//await Promise.all(connections.map(connection => connection.bothOpen));
        console.log('end setup', Date.now() - start);
      }, nPairs * 2e3);
      for (let index = 0; index < nPairs; index++) {
        it(`connects ${index}.`, function () {
          const {A, B} = connections[index];
          expect(A.ours.readyState).toBe('open');
          expect(B.ours.readyState).toBe('open');
          expect(A.theirs.readyState).toBe('open');
          expect(B.theirs.readyState).toBe('open');
        });
        it(`receives ${index}.`, async function () {
          const {A, B} = connections[index];
          await B.gotData;
          expect(B.receivedMessageCount).toBe(A.sentMessageCount);
          await A.gotData;	  
          expect(A.receivedMessageCount).toBe(B.sentMessageCount);
        });
        it(`learns of one open ${index}.`, function () {
          const {A, B} = connections[index];    
          expect(A.sentMessageCount).toBe(1);
          expect(B.sentMessageCount).toBe(1);
        });
	let waitBefore = Math.random() < 0.5;
	it(`re-negotiates ${index} waiting to settle ${waitBefore ? 'before' : 'after'} sending.`, async function () {
	  const {A, B} = connections[index];	    
	  await A.gotData; // if receive test hasn't fired yet, the set setup might not yet have completed capturing the send count.
	  await B.gotData;

	  // Capture counts expected by the other tests.
	  const {sentMessageCount:aSend, receivedMessageCount:aReceive} = A;
	  const {sentMessageCount:bSend, receivedMessageCount:bReceive} = B;

	  async function reneg(A, B) {
	    let aIce = A.renegotiate();
	    // We're supposed to be able to send and receive during renegotiation, so we flip a coin
	    // as to whether the test will wait before sending or after.
	    const timeout = 1e3; // NodeJS usually resolves with our side or sometimes the other going to completed, but not browsers.
	    if (waitBefore) await Promise.race([aIce, B.iceConnected, WebRTC.delay(timeout)]);
	    const gotData = new Promise(resolve => B.ours.addEventListener('message', e => resolve(e.data)));
	    A.theirs.send('after');
	    expect(await gotData).toBe('after');
	    if (!waitBefore) await Promise.race([aIce, B.iceConnected, WebRTC.delay(timeout)]);
	  }
	  await reneg(A, B);
	  await reneg(B, A);

	  // Restore counts expected by the other tests.
	  Object.assign(A, {sentMessageCount:aSend, receivedMessageCount:aReceive});
	  Object.assign(B, {sentMessageCount:bSend, receivedMessageCount:bReceive});	  
	}, 10e3);
	if (includeSecondChannel) {
	  it(`handles second channel ${index}.`, async function () {
	    const {A, B} = connections[index];
	    const aOpen = A.getDataChannelPromise('second');
	    const bOpen = B.getDataChannelPromise('second');
	    const a = A.createChannel('second', {negotiated: true});
	    const b = B.createChannel('second', {negotiated: true});
	    const dca = await aOpen;
	    let gotit = new Promise(resolve => {
	      dca.onmessage = event => resolve(event.data);
	    });
	    const dcb = await bOpen;
	    const start = Date.now();
	    dcb.send('message');
	    expect(await Promise.race([gotit, WebRTC.delay(2e3, 'timeout')])).toBe('message');
	  });
	}
        if (includeConflictCheck) {
          it(`politely ignores a conflict ${index}.`, function () {
            const {A, B} = connections[index];
            expect(A.rolledBack).toBeFalsy();
            expect(B.rolledBack).toBeTruthy(); // timing dependent, but useful for debugging
          });
        }
      }
      afterAll(async function () {
        const start = Date.now();
        console.log('start teardown');
        const promises = [];
        for (let index = 0; index < nPairs; index++) {
          const {A, B} = connections[index];
	  let promise = A.close().then(async apc => {
            expect(apc.connectionState).toBe('closed'); // Only on the side that explicitly closed.
            expect(apc.signalingState).toBe('closed');

	    await B.close(); // fixme: B will try to reconnect unless we tell it to stop.

	    const bpc = await B.closed; // Waiting for B to notice.
	    await B.close(); // Resources are not necessarilly freed when the other side closes. An explicit close() is needed.
            expect(['closed', 'disconnected', 'failed']).toContain(bpc.connectionState);
	    expect(['closed', 'stable']).toContain(bpc.signalingState);
	    delete connections[index];
	  });
          promises.push(promise);
        }
        await Promise.all(promises);
        console.log('end teardown', Date.now() - start);        
      }, Math.max(30e3, 1e3 * nPairs));
    }
    describe("one side opens", function () {
      // One of each pair definitively initiates the connection that the other side was waiting for. This can happen
      // when one peer contacts another out of the blue, or when a client contacts a server or portal.
      // We test the usual negotiated=true case (where the initiator names the bidirectional channel and the app
      // arranges for the reciever to actively create a channel with the same app-specific name,
      // and the negotiated=false case.

      describe('non-negotiated', function () {
	beforeAll(function () {console.log('one-sided non-negotiated'); });
        standardBehavior(async function ({index}) {
          const {A, B, bothOpen} = await makePair({index});
          A.createChannel('data', {negotiated: false});
          await bothOpen;
        }, {includeConflictCheck: false, includeSecondChannel: false});
      });
      describe("negotiated on first signal", function () {
	beforeAll(function () {console.log('one-sided negotiated'); });
        standardBehavior(async function ({index}) {
          const {A, B, bothOpen} = await makePair({index});
          // There isn't really a direct, automated way to have one side open another with negotiated:true,
          // because the receiving RTCPeerConnection does not fire 'datachannel' when the sender was negotiated:true.
          // However, what the app can do is wake up and create an explicit createChannel when it first receives an
          // unsolicited offer. 
          let awake = false;
          A.signal = async msg => {
            if (!awake) {
              awake = true;
              B.createChannel("data", {negotiated: true});
            }
            B.onSignal(msg);
          };
          A.createChannel('data', {negotiated: true});
          await bothOpen;
        }, {includeConflictCheck: false});
      });
    });

    describe("simultaneous two-sided", function () {
      // The two sides both attempt to initiate a connection at the same time. This can happen betwen homogeneous peers.
      // There is a matrix of four possibilities:
      //
      // negotiated=true - the usual case, in which the application expects both sides to be be created with the same
      //   app-specific bidirectional channel name...
      // negotiatedl=false - meaning that each side is going to create it's own sending channel which will automatically
      //   have a distinct index (even if the channel name is the same).
      //
      // Within these, we test with the "polite" side starting first, or starting second. On the network, we cannot
      // coordinate which app instance will attempt to initiate connection, but we can arrange for any pair to agree
      // on which of the two is the "polite" one (e.g., by sort order of their names or some such).

      describe("negotiated single full-duplex-channel", function () {
        describe("impolite first", function () {
	  beforeAll(function () {console.log('two-sided negotiated impolite-first'); });
          standardBehavior(async function ({index}) {
            const {A, B, bothOpen} = await makePair({index});
            A.createChannel("data", {negotiated: true});
            B.createChannel("data", {negotiated: true});
            await bothOpen;
          }, {reneg: true});
        });
        describe("polite first", function () {
	  beforeAll(function () {console.log('two-sided negotiated polite-first');});
          standardBehavior(async function ({index}) {
            const {A, B, bothOpen} = await makePair({index,});
	    //await WebRTC.delay(1); // TODO: Why is this needed?
            B.createChannel("data", {negotiated: true});
            A.createChannel("data", {negotiated: true});
            await bothOpen;
          }, {reneg: true});
        });
      });
      describe("non-negotiated dual half-duplex channels", function () { // fixme: sometimes fail to renegotiate
        const delay = 200;
	const debug = false;
        describe("impolite first", function () {
	  beforeAll(function () {console.log('two-sided non-negotiated impolite-first');});
          standardBehavior(async function ({index}) {
            const {A, B, bothOpen} = await makePair({delay, index, debug});
	    //await WebRTC.delay(1); // TODO: Why is this needed?
            A.createChannel("data", {negotiated: false});
            B.createChannel("data", {negotiated: false});
            await bothOpen;
          });
        });
        describe("polite first", function () {
	  beforeAll(function () {console.log('two-sided non-negotiated polite-first');});
          standardBehavior(async function ({index}) {
            const {A, B, bothOpen} = await makePair({delay, index, debug});
            B.createChannel("data", {negotiated: false});
            A.createChannel("data", {negotiated: false});
            await bothOpen;
          });
        });
      });
    });
  });
});
