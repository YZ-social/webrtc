import { WebRTC } from './webrtc.js';

export class TrickleWebRTC extends WebRTC {
  // Same idea as PromiseWebRTC, but instead of waiting for End of Ice (or timeout), signals will resolve as soon as there
  // are any signals ready to be picked up, and a new call to get signals will start collecting a new set of promises.
  // Signals stops collecting new signals when we connect (even if there are more ice candidates, and even if signals is
  // an empty array at that point).

  get signals() { // Returns a promise that collects signals until the next time someone calls this.signals,
    // but which resolves as soon as it is not empty (and continues to accumulate).
    // Clients must be careful to no grab a new signals promise until the previous one has resolved.
    const { xx = 0, sending } = this;
    const { promise, resolve } = Promise.withResolvers();
    const counter = xx;
    Object.assign(promise, {resolve, counter});
    this._signalPromise = promise;
    this.sending = [];
    this.xx = counter + 1;
    //console.log(this.label, 'get signals', {xx, sending, promise, counter, promise, sending: this.sending});
    return promise;
  }
  set signals(data) { // Set with the signals received from the other end.
    data.forEach(([type, message]) => this[type](message));
  }
  // onLocalEndIce() {
  //   console.log(this.label, 'end ice');
  //   this.signal('icecandidate', null); // So that clients can recognize that they should not await more signals.
  // }
  // connectionStateChange(state) {
  //   //console.log(this.label, 'connection state', state);    
  //   super.connectionStateChange(state);
  //   //this._signalPromise.resolve(this.sending);
  // }
  sending = [];
  signal(type, message) {
    super.signal(type, message);
    this.sending.push([type, message]);
    // Until another call to get signals (which replaces _signalPromise), we will continue to accumulate into
    // the same sending array, and subsequent signals will re-resolve (which has no effect on the promise).
    this._signalPromise.resolve(this.sending);
    //console.log(this.label, 'signal', type, 'resolving', this._signalPromise);
  }
  // close() {
  //   if (this.peer.connectionState === 'failed') this._signalPromise?.reject?.();
  //   super.close();
  //   // this._signalPromise = null;
  //   // this.sending = [];
  // }
}
