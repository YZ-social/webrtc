//import wrtc from '#wrtc'; // fixme
const wrtc = (typeof(process) === 'undefined') ? globalThis : (await import('#wrtc')).default;

export class WebRTC {
  constructor(properties) {
    Object.assign(this, properties);

    this.pc = new wrtc.RTCPeerConnection({ iceServers: [] });
    const {promise, resolve} = Promise.withResolvers();
    this.closed = promise;
    this.pc.addEventListener('signalingstatechange', () => {
      if (this.pc.signalingState !== 'closed') return;
      resolve(this.pc);
    });
    
    this.makingOffer = false;
    this.ignoreOffer = false;

    this.pc.onicecandidate = e => {
      //this.log(this.name, 'generated ice', !!e.candidate);
      if (e.candidate) {
        this.signal({ candidate: e.candidate });
      }
    };
    this.pc.ondatachannel = e => { // Fires only on the answer side if the offer side opened without negotiated:true.
      const dc = e.channel;
      this.log('***', this.name, 'ondatachannel:', dc.label, dc.id, dc.readyState, dc.negotiated, '****');
      if (!dc.negotiated) this.setupChannel(e.channel);
    };
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        this.log(this.name, 'creating offer in state:', this.pc.signalingState);
	const offer = await this.pc.createOffer(); // The current wrtc for NodeJS doesn't yet support setLocalDescription with no arguments.
	if (this.pc.signalingState != "stable") return; // https://blog.mozilla.org/webrtc/perfect-negotiation-in-webrtc/
	this.log(this.name, 'setting local offer in state:', this.pc.signalingState);
        await this.pc.setLocalDescription(offer).catch(e => console.log(this.name, 'error set local original offer while in state', this.pc.signalingState, e));
        this.signal({ description: this.pc.localDescription });
      } finally {
        this.makingOffer = false;
      }
    };
  }
  async close() {
    await this.closeDataChannels(); // I've seen Chrome hang if this is ommitted.
    this.pc.close();
    if (this.pc.signalingState === 'closed') return Promise.resolve();
    return this.closed;
  }
  log(...rest) {
    if (this.debug) console.log(...rest);
  }
  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async onSignal({ description, candidate }) {
    // Most of this and onnegotiationneeded is from https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
    if (description) {
      const offerCollision =
        description.type === "offer" &&
            (this.makingOffer || (this.pc.signalingState !== "stable" && !this.settingRemote));

      this.ignoreOffer = !this.polite && offerCollision;
      this.log(this.name, 'got', description.type, this.pc.signalingState, 'making:', this.makingOffer, 'collision:', offerCollision, 'ignore:', this.ignoreOffer, 'settingRemote:', this.settingRemote);

      if (this.ignoreOffer) {
        this.log(this.name, "ignoring offer (collision)");
        return;
      }

      if (/*typeof(process) !== 'undefined' && */offerCollision) {
	// The current wrtc for NodeJS doesn't yet support automatic rollback. We need to make it explicit.
	await Promise.all([ // See https://blog.mozilla.org/webrtc/perfect-negotiation-in-webrtc/
          this.pc.setLocalDescription({type: "rollback"}).then(() => this.log(this.name, 'rollback ok'), e => console.log(this.name, 'error rollback', e)),
          this.pc.setRemoteDescription(description).then(() => this.log(this.name, 'set offer ok'), e => console.log(this.name, 'error set remote with rollback', e))
	]);
	this.rolledBack = true; // For diagnostics.
	this.log(this.name, 'rolled back. producing answer');
      } else {
	this.settingRemote = true; // fixme remove
	try {
	  await this.pc.setRemoteDescription(description).catch(e => console.log(this.name, 'error set remote offer while in state', this.pc.signalingState, e));
	  if (offerCollision) this.rolledBack = true;
	} finally {
	  this.settingRemote = false;
	}
      }

      if (description.type === "offer") {
	const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer).catch(e => console.log(this.name, 'error set local answer', e));
        this.signal({ description: this.pc.localDescription });
      }
    } else if (candidate) {
      try {
	//this.log(this.name, 'add ice');
        await this.pc.addIceCandidate(candidate);
      } catch (e) {
        if (!this.ignoreOffer) throw e;
      }
    }
  }

  receivedMessageCount = 0;
  dataChannels = {};
  setupChannel(dc) {
    const nameExists = this[dc.label];
    this.log(this.name, 'setup:', dc.label, dc.id, dc.readyState, 'negotiated:', dc.negotiated, 'nameExists:', !!nameExists);
    this[dc.label] = dc;
    this.dataChannels[dc.label] = dc;
    dc.onmessage = e => {
      this.receivedMessageCount++;
      this.log(this.name, 'onmessage: ', dc.label, dc.id, e.data);
    };
    dc.onopen = async () => {
      this.log(this.name, 'channel onopen:', dc.label, dc.id, dc.readyState, dc.negotiated);
      if (!nameExists) this.dataChannelPromises[dc.label]?.resolve(dc);
    };
    if (dc.readyState === 'open' && dc.negotiated) {
      dc.onopen();
    }
  }
  channelId = 128; // Non-negotiated channel.id get assigned at open by the peer, starting with 0. This avoids conflicts.
  ensureChannel(name = 'data', options = {}) { // Explicitly create it.
    if (options.negotiated && !options.id) options = {id: this.channelId++, ...options};
    this.setupChannel(this.pc.createDataChannel(name, options));
  }
  dataChannelPromises = {};
  getDataChannelPromise(name = 'data') { // Promise to resolve when opened, WITHOUT actually creating one.
    const {promise, resolve, reject} = Promise.withResolvers();
    Object.assign(promise, {resolve, reject});
    return this.dataChannelPromises[name] = promise;
  }
  async closeDataChannels() {
    for (const dc of Object.values(this.dataChannels)) {
      if (dc.readyState === 'closed') continue;
      const closed = new Promise(resolve => dc.onclose = () => resolve());
      dc.close();
      await closed;
    }
  }

  sentMessageCount = 0;
  sendOn(label, msg) {
    const dc = this[label];
    if (dc && dc.readyState === "open") {
      dc.send(msg);
      this.sentMessageCount++;
    }
  }
}

