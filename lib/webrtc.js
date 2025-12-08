import { WebRTCBase } from './webrtcbase.js';

export class WebRTC extends WebRTCBase {

  async respond(signals) { // When a peer sends an offer or ice, this can be used to respond.
    this.signals = signals;
    await this.signalsReady;
    return this.signals;
  }
  async connectVia(responder) { // Resolves when connected to the peer signaled via responder.
    // Use like this (see test suite):
    // let promise = this.signalsReady;
    // let dataChannelPromise = this.ensureDataChannel(channelName); // Or something else that triggers negotiation.
    // const aSignals = await promise;
    // await this.connectVia(somethingThatCreatesPeerAndExchangesSigansl)); // Typically through peer.respond(signals).
    
    const returning = await responder(this.signals); // this.signals might be an empty list.
    if (!returning?.length) return;
    if (this.peer.iceGatheringState !== 'gathering') return; // All done.
    this.signals = returning;
    await this.connectVia(responder); // Keep "long-polling" the other side until it has nothing left to say.
  }
  
  sending = [];
  get signals() { // Answer the signals that have fired on this end since the last time this.signals was asked for.
    let pending = this.sending;
    this.sending = [];
    return pending;
  }
  set signals(data) { // Set with the signals received from the other end.
    data.forEach(([type, message]) => this[type](message));
  }

  signalResolvers = [];
  resetAndResolveSignals() { // Any pending.
    let resolvers = this.signalResolvers; // Reset and resolve all pending resolvers.
    this.signalResolvers = [];
    for (const resolve of resolvers) resolve(null);
  }    
  get signalsReady() { // Return a promise that resolves as soon as there any ready.
    // Each time that a client calls get signalsReady, a new promise is generated.
    if (this.sending.length) return Promise.resolve(null);
    const { promise, resolve } = Promise.withResolvers();
    this.signalResolvers.push(resolve);
    return promise;
  }

  signal(type, message) { // Handle signals being generated on this side, by accumulating them for get signals
    super.signal(type, message);
    this.sending.push([type, message]);
    this.resetAndResolveSignals();
  }
  connectionStateChange(state) { // When we connect, resetAndResolveSignals.
    super.connectionStateChange(state);
    if ('connected' === state) this.resetAndResolveSignals();
  }
}
