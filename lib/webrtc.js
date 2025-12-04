import { WebRTCDataChannels } from './datachannels.js';

// Basics.
export class WebRTC extends WebRTCDataChannels {
  static connections = new Map();
  static ensure({serviceLabel, multiplex = true, ...rest}) { // Answer the named connection, creating it if there isn't already a CONNECTED one by this name.
    // The serviceLabel is used as the log label throughout.
    // E.g., if a node has connections to many other nodes, but with multiple channels on each connection, then it is
    // convenient to name the shared connection with the id of the other side.
    //
    // If running both ends in the same Javascript, be sure to give them different names!

    let connection = this.connections.get(serviceLabel);
    // It is possible that we were backgrounded before we had a chance to act on a closing connection and remove it.
    if (connection) {
      const {connectionState, signalingState} = connection.peer;
      if ((connectionState === 'new') || (connectionState === 'closed') || (signalingState === 'closed')) connection = null;
    }
    if (!connection) {
      connection = new this({label: serviceLabel, multiplex, ...rest});
      if (multiplex) this.connections.set(serviceLabel, connection);
    }
    return connection;
  }

  // Handlers for signal messages from the peer.
  // Note that one peer will receive offer(), and the other will receive answer(). Both receive icecandidate.
  offer(offer) { // Handler for receiving an offer from the other user (who started the signaling process).
    // Note that during signaling, we will receive negotiationneeded/answer, or offer, but not both, depending
    // on whether we were the one that started the signaling process.
    this.peer.setRemoteDescription(offer)
      .then(_ => this.peer.createAnswer())
      .then(answer => this.peer.setLocalDescription(answer)) // promise does not resolve to answer
      .then(_ => this.signal('answer', this.peer.localDescription));
  }
  answer(answer) { // Handler for finishing the signaling process that we started.
    this.peer.setRemoteDescription(answer);
  }
  icecandidate(iceCandidate) { // Handler for a new candidate received from the other end through signaling.
    this.peer.addIceCandidate(iceCandidate).catch(error => this.icecandidateError(error));
  }
}
