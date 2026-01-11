const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach} = globalThis; // For linters.
import { WebRTC } from '../index.js';

describe("WebRTC", function () {
  const isBrowser = typeof(process) === 'undefined';
  let connections = [];
  describe("direct in-process signaling", function () {
    function makePair({debug = false, delay = 0, index = 0} = {}) {
      //const configuration = { iceServers: [] };
      const configuration = { iceServers: WebRTC.iceServers };
      const A = new WebRTC({name: `A (impolite) ${index}`, polite: false, debug, configuration});
      const B = new WebRTC({name: `B (polite) ${index}`, polite: true, debug, configuration});
      async function sendingSetup(dc) { // Given an open channel, set up to receive a message and then send a test message.
        const webrtc = dc.webrtc;
        webrtc.log('got open channel', dc.label, dc.id, 'gotDataPromise:', webrtc.gotData ? 'exists' : 'not yet wet');
        webrtc.receivedMessageCount = webrtc.sentMessageCount = 0;

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
        // on the other.) However, getDataChannelPromise retursn a promise based on the specified name alone, and it only
        // resolves once. For compatibility with the single-sided case, we resolve the first channel on each side, which
        // are different ids. Ideally here we could attach onmessage to one channel and send on the other, but we cannot be sure
	// of the events. So, for maximum compatibility in all cases, our test "applications" creates one webrtc.gotData promise
	// that resolves on data from the onmessage handler hung on any-and-all data channels on each side.

	if (!webrtc.gotData) {
	  webrtc.gotData = new Promise(resolve => webrtc.gotDataResolver = resolve);
	}
        dc.onmessage = e => {
          webrtc.receivedMessageCount++;
          webrtc.log('got message on', dc.label, dc.id, e.data);
	  webrtc.gotDataResolver(e.data);
	};
        webrtc.sentMessageCount++;

        if (!delay) return dc.send(`Hello from ${webrtc.name}`);
        await WebRTC.delay(delay);
	webrtc.log('sendiing on data', webrtc.data.id);
        webrtc.data.send(`Hello from ${webrtc.name}`);
        return null;
      }
      const aOpen = A.getDataChannelPromise('data').then(sendingSetup);
      const bOpen = B.getDataChannelPromise('data').then(sendingSetup);
      const direct = true; // Does signal work direct/one-sided to the other? False makes a request that waits for a response.
      if (direct) {
	A.signal = message => B.onSignal(message);
	B.signal = message => A.onSignal(message);
      } else {
	A.transferSignals = messages => B.respond(messages);
	B.transferSignals = messages => A.respond(messages);
      }
      return connections[index] = {A, B, bothOpen: Promise.all([aOpen, bOpen])};
    }
    function standardBehavior(setup, {includeConflictCheck = isBrowser, includeSecondChannel = false} = {}) {
      // maximums
      // 1 channel pair, without negotiated on first signal: nodejs:83, firefox:150+, safari:85+ but gets confused with closing, chrome/edge:50(?)
      // 50 works across the board with one channel pair
      // On Safari (only), anything more than 32 pair starts to loose messages on the SECOND channel.
      const nPairs = 5; // fixme after we get GHA working includeSecondChannel ? 32 : 62; //32;
      beforeAll(async function () {
        const start = Date.now();
        console.log(new Date(), 'start setup', nPairs, 'pairs');
        for (let index = 0; index < nPairs; index++) {
          await setup({index});
        }
	//await Promise.all(connections.map(connection => connection.bothOpen));
        console.log('end setup', Date.now() - start);
      }, nPairs * 1e3);
      for (let index = 0; index < nPairs; index++) {
        it(`connects ${index}.`, function () {
          const {A, B} = connections[index];
          expect(A.data.readyState).toBe('open');
          expect(B.data.readyState).toBe('open');
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
	    const bpc = await B.closed; // Waiting for B to notice.
	    await B.close(); // Resources are not necessarilly freed when the other side closes. An explicit close() is needed.
            expect(['closed', 'disconnected', 'failed']).toContain(B.pc.connectionState);
	    expect(bpc.signalingState).toBe('closed');
	  });
          promises.push(promise);
        }
        await Promise.all(promises);
        console.log('end teardown', Date.now() - start);        
      }, Math.max(30e3, 1e3 * nPairs));
    }
    describe("one side opens", function () {
      describe('non-negotiated', function () {
        standardBehavior(async function ({index}) {
          const {A, B, bothOpen} = makePair({index});
          A.createChannel('data', {negotiated: false});
          await bothOpen;
        }, {includeConflictCheck: false, includeSecondChannel: false});
      });
      describe("negotiated on first signal", function () {
        standardBehavior(async function ({index}) {
          const {A, B, bothOpen} = makePair({index});
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
      describe("negotiated single full-duplex-channel", function () {
        describe("impolite first", function () {
          standardBehavior(async function ({index}) {
            const {A, B, bothOpen} = makePair({index});     
            A.createChannel("data", {negotiated: true});
            B.createChannel("data", {negotiated: true});
            await bothOpen;
          });
        });
        describe("polite first", function () {
          standardBehavior(async function ({index}) {
            const {A, B, bothOpen} = makePair({index});
            B.createChannel("data", {negotiated: true});
            A.createChannel("data", {negotiated: true});
            await bothOpen;
          });
        });
      });
      describe("non-negotiated dual half-duplex channels", function () {
        const delay = 200;
	const debug = true;
        describe("impolite first", function () {
          standardBehavior(async function ({index}) {
            const {A, B, bothOpen} = makePair({delay, index, debug});
            A.createChannel("data", {negotiated: false});
            B.createChannel("data", {negotiated: false});
            await bothOpen;
          });
        });
        // describe("polite first", function () {
        //   standardBehavior(async function ({index}) {
        //     const {A, B, bothOpen} = makePair({delay, index, debug});
        //     B.createChannel("data", {negotiated: false});
        //     A.createChannel("data", {negotiated: false});
        //     await bothOpen;
        //   });
        // });
      });
    });
  });
});
