//import wrtc from '#wrtc'; // fixme
const wrtc = (typeof(process) === 'undefined') ? globalThis : (await import('#wrtc')).default;

export class WebRTC {
  static iceServers = [ // Some default stun and even turn servers.

    { urls: 'stun:stun.l.google.com:19302'},
    // https://freestun.net/  Currently 50 KBit/s. (2.5 MBit/s fors $9/month)
    { urls: 'stun:freestun.net:3478' },

    //{ urls: 'turn:freestun.net:3478', username: 'free', credential: 'free' },
    // Presumably traffic limited. Can generate new credentials at https://speed.cloudflare.com/turn-creds
    // Also https://developers.cloudflare.com/calls/ 1 TB/month, and $0.05 /GB after that.
    { urls: 'turn:turn.speed.cloudflare.com:50000', username: '826226244cd6e5edb3f55749b796235f420fe5ee78895e0dd7d2baa45e1f7a8f49e9239e78691ab38b72ce016471f7746f5277dcef84ad79fc60f8020b132c73', credential: 'aba9b169546eb6dcc7bfb1cdf34544cf95b5161d602e3b5fa7c8342b2e9802fb' }

    // See also:
    // https://fastturn.net/ Currently 500MB/month? (25 GB/month for $9/month)
    // https://xirsys.com/pricing/ 500 MB/month (50 GB/month for $33/month)
    // Also https://www.npmjs.com/package/node-turn or https://meetrix.io/blog/webrtc/coturn/installation.html
  ];
  constructor({configuration = {iceServers: WebRTC.iceServers}, ...properties}) {
    Object.assign(this, properties);

    this.pc = new wrtc.RTCPeerConnection(configuration);
    const {promise, resolve} = Promise.withResolvers(); // To indicate when closed.
    promise.resolve = resolve;
    this.closed = promise;
    // Safari doesn't fire signalingstatechange for closing activity.
    this.pc.addEventListener('connectionstatechange', () => { // Only fires by action from other side.
      const state = this.pc.connectionState;
      if (state === 'connected') return this.signalsReadyResolver?.();
      if (['new', 'connecting'].includes(state)) return null;
      this.log('connectionstatechange signaling/connection:', this.pc.signalingState, state);
      return resolve(this.pc);
    });

    this.connectionStartTime = Date.now();
    this.makingOffer = false;
    this.ignoreOffer = false;

    this.pc.onicecandidate = e => {
      if (!e.candidate) return;
      this.signal({ candidate: e.candidate });
    };
    this.pc.ondatachannel = e => this.ondatachannel(e.channel);
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        this.log('creating offer in state:', this.pc.signalingState);
	const offer = await this.pc.createOffer(); // The current wrtc for NodeJS doesn't yet support setLocalDescription with no arguments.
	if (this.pc.signalingState != "stable") return; // https://blog.mozilla.org/webrtc/perfect-negotiation-in-webrtc/
	this.log('setting local offer in state:', this.pc.signalingState);
        await this.pc.setLocalDescription(offer)
	  .catch(e => console.log(this.name, 'ignoring error in setLocalDescription of original offer while in state', this.pc.signalingState, e));
        this.signal({ description: this.pc.localDescription });
      } finally {
        this.makingOffer = false;
      }
    };
  }
  async close() {
    // Do not try to close or wait for data channels. It confuses Safari.
    this.pc.close();
    this.closed.resolve(this.pc); // We do not automatically receive 'connectionstatechange' when our side explicitly closes. (Only if the other does.)
    return this.closed;
  }
  flog(...rest) {
    if (this.debug) console.log(new Date(), this.name, ...rest);
  }
  log(...rest) {
    if (this.debug) this.flog(...rest);
  }
  static delay(ms, value) {
    return new Promise(resolve => setTimeout(resolve, ms, value));
  }

  // Must include NodeJS, and must not include Chrome/Edge. Safari and Firefox can be either.
  explicitRollback = typeof(globalThis.process) !== 'undefined';
  async onSignal({ description, candidate }) {
    // Most of this and onnegotiationneeded is from https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
    if (description) {
      const offerCollision =
        description.type === "offer" &&
            (this.makingOffer || (this.pc.signalingState !== "stable" && !this.settingRemote));

      this.ignoreOffer = !this.polite && offerCollision;
      this.flog('onSignal', description.type, this.pc.signalingState, 'making:', this.makingOffer, 'collision:', offerCollision, 'ignore:', this.ignoreOffer, 'settingRemote:', this.settingRemote);

      if (this.ignoreOffer) {
        this.log("ignoring offer (collision)");
        return;
      }

      if (this.explicitRollback && offerCollision) {
	// The current wrtc for NodeJS doesn't yet support automatic rollback. We need to make it explicit.
	await Promise.all([ // See https://blog.mozilla.org/webrtc/perfect-negotiation-in-webrtc/
          this.pc.setLocalDescription({type: 'rollback'})
	    .then(() => this.log('rollback ok'), e => console.log(this.name, 'ignoring error in rollback', e)),
          this.pc.setRemoteDescription(description)
	    .then(() => this.log('set offer ok'), e => console.log(this.name, 'ignoring error setRemoteDescription with rollback', e))
	]);
	this.rolledBack = true; // For diagnostics.
	this.flog('rolled back. producing answer');
      } else {
	this.settingRemote = true;
	try {
	  await this.pc.setRemoteDescription(description)
	    .catch(e => console.log(this.name, 'ignoring error in setRemoteDescription while in state', this.pc.signalingState, e));
	  if (offerCollision) this.rolledBack = true;
	} finally {
	  this.settingRemote = false;
	}
      }

      if (description.type === "offer") {
	const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer)
	  .catch(e => console.log(this.name, 'ignoring error setLocalDescription of answer', e));
        this.signal({ description: this.pc.localDescription });
      }

    } else if (candidate) {
      //this.log('add ice');
      if (this.pc.connectionState === 'closed' || !this.pc.remoteDescription?.type) { // Adding ice without a proceessed offer/answer will crash. Log and drop the candidate.
	this.flog('icecandidate, connection:', this.pc.connectionState, 'signaling:', this.pc.signalingState, 'ice connection:', this.pc.iceConnectionState, 'gathering:', this.pc.iceGatheringState);
	return;
      }
      await this.pc.addIceCandidate(candidate)
	.catch(e => { if (!this.ignoreOffer && this.pc.connectionState !== 'closed') throw e; });
    }
  }

  async onSignals(signals) { // Apply a list of signals. Do not wait for a response.
    for (const signal of signals) {
      await this.onSignal(signal); // Wait for, e.g., offer/answer to be processed before adding the next.
    }
  }
  signalsReadyResolver = null;
  pendingSignals = [];
  async respond(signals = []) { // Apply a list of signals, and promise a list of responding signals as soon as any are available, or empty list when connected
    // This is used by a peer that is receiving signals in an out-of-band network request, and witing for a response. (Compare transferSignals.)
    this.log('respond', signals.length, 'signals');
    const {promise, resolve} = Promise.withResolvers;
    this.signalsReadyResolver = resolve;
    await this.onSignals(signals);
    await promise;
    this.signalsReadyResolver = null;
    return this.collectPendingSignals();
  }
  collectPendingSignals() { // Return any pendingSignals and reset them.
    // We do not assume a promise can resolve to them because more could be added between the resolve and the (await promise).
    const signals = this.pendingSignals;
    this.pendingSignals = [];
    return signals;
  }
  signal(signal) { // Deal with a new signal on this peer.
    // If this peer is responding to the other side, we arrange our waiting respond() to continue with data for the other side.
    //
    // Otherwise, if this side is allowed to initiate an outbound network request, then this side must define transferSignals(signals)
    // to promise otherSide.respond(signals). If so, we call it with all pending signals (including the new one) and handle the the
    // response. (Which latter may trigger more calls to signal() on our side.)
    //
    // Otherwise, we just remember the signal for some future respond() on our side.
    //
    // Note that this is compatible with both initiating and responding. E.g., both sides could attempt to transfserSignals()
    // at the same time, in overlapping requests. Both will resolve.
    this.log('signal', signal.description?.type || 'icecandidate', 'waiting:', !!this.signalsReadyResolver, 'has transfer:', !!this.transferSignals, 'on pending:', this.pendingSignals.length);
    this.pendingSignals.push(signal);
    const waiting = this.signalsReadyResolver; // As maintained and used by respond()
    if (waiting) {
      waiting();
      return;
    }
    if (!this.transferSignals) return; // Just keep collecting until the next call to respond();
    this.transferSerializer = this.transferSerializer.then(() => {
      return this.transferSignals(this.collectPendingSignals()).then(response => this.onSignals(response));
    });
  }
  transferSerializer = Promise.resolve();

  dataChannels = {};
  setupChannel(dc) { // Given an open or connecting channel, set it up in a unform way.
    this.log('setup:', dc.label, dc.id, dc.readyState, 'negotiated:', dc.negotiated, 'exists:', !!this[dc.label]);
    this[dc.label] = this.dataChannels[dc.label] = dc;
    dc.webrtc = this;
    dc.onopen = async () => {
      this.log('channel onopen:', dc.label, dc.id, dc.readyState, 'negotiated:', dc.negotiated);
      this.dataChannelPromises[dc.label]?.resolve(this[dc.label]);
    };
    if (dc.readyState === 'open') dc.onopen();
    return dc;
  }
  ondatachannel(dc) {
    // Fires only on the answer side if the offer side opened with negotiated:false
    // This our chance to setupChannel, just as if we had called createChannel
    this.log('ondatachannel:', dc.label, dc.id, dc.readyState, dc.negotiated);
    this.setupChannel(dc);
    dc.onopen(); // It had been opened before we setup, so invoke handler now.
  }
  channelId = 128; // Non-negotiated channel.id get assigned at open by the peer, starting with 0. This avoids conflicts.
  createChannel(name = 'data', {negotiated = false, id = this.channelId++, ...options} = {}) { // Explicitly create channel and set it up.
    return this.setupChannel(this.pc.createDataChannel(name, {negotiated, id, ...options}));
  }
  dataChannelPromises = {};
  getDataChannelPromise(name = 'data') { // Promise to resolve when opened, WITHOUT actually creating one.
    const {promise, resolve, reject} = Promise.withResolvers();
    Object.assign(promise, {resolve, reject});
    return this.dataChannelPromises[name] = promise;
  }

  async reportConnection(doLogging = false) { // Update self with latest wrtc stats (and log them if doLogging true). See Object.assign for properties.
    const stats = await this.pc.getStats();
    let transport;
    for (const report of stats.values()) {
      if (report.type === 'transport') {
	transport = report;
	break;
      }
    }
    let candidatePair = transport && stats.get(transport.selectedCandidatePairId);
    if (!candidatePair) { // Safari doesn't follow the standard.
      for (const report of stats.values()) {
	if ((report.type === 'candidate-pair') && report.selected) {
	  candidatePair = report;
	  break;
	}
      }
    }
    if (!candidatePair) {
      console.warn(this.label, 'got stats without candidatePair', Array.from(stats.values()));
      return;
    }
    const remote = stats.get(candidatePair.remoteCandidateId);
    const {protocol, candidateType} = remote;
    const now = Date.now();
    const statsElapsed = now - this.connectionStartTime;
    Object.assign(this, {stats, transport, candidatePair, remote, protocol, candidateType, statsTime: now, statsElapsed});
    if (doLogging) console.info(this.name, 'connected', protocol, candidateType, (statsElapsed/1e3).toFixed(1));
  }
}

