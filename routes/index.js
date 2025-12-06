import express from 'express';
import { PromiseWebRTC, TrickleWebRTC } from '../index.js';
import { WebRTCNG } from '../lib/webrtcng.js';
export const router = express.Router();
 
 const testConnections = {}; // Is it really necessary to keep these around, against garbage collection?
router.post('/promise/echo/:tag', async (req, res, next) => { // Test endpoint for WebRTC.
  // Client posts collected signal data to us.
  // We create a WebRTC connection here with the given tag, and answer our response signals.
  // We also create message handler on the channel that just sends back whatever comes over
  // from the other side.
  const {params, body} = req;
  const tag = params.tag;
  const signals = body;
  const connection = testConnections[tag] = new PromiseWebRTC({label: tag});
  const timer = setTimeout(() => connection.close(), 15e3);
  const dataPromise = connection.getDataChannelPromise('echo');
  dataPromise.then(dataChannel => {
    dataChannel.onclose = () => {
      clearTimeout(timer);
      connection.close();
      delete testConnections[tag];
    };
    dataChannel.onmessage = event => dataChannel.send(event.data); // Just echo what we are given.
  });
  connection.signals = signals; // Convey the posted offer+ice signals to our connection.
  res.send(await connection.signals); // Send back our signalling answer+ice.
});
router.post('/trickle/echo/:tag', async (req, res, next) => { // Test endpoint for WebRTC.
  // Same as above, but using trickle ice. The server "peer" is created first and given
  // the initial offer as above. But then the client reposts (long polling) to give
  // ice candidates and the server waits until there are any to give back (or connection).
  const {params, body} = req;
  const tag = params.tag;
  const incomingSignals = body;
  let connection = testConnections[tag];
  //console.log('post connection:', !!connection, 'incoming:', incomingSignals.map(s => s[0]));
  if (!connection) {
    connection = testConnections[tag] = TrickleWebRTC.ensure({serviceLabel: tag});
    const timer = setTimeout(() => connection.close(), 15e3);
    //console.log('created connection and applying', incomingSignals.map(s => s[0]));
    connection.next = connection.signals;
    const dataPromise = connection.dataChannelPromise = connection.ensureDataChannel('echo', {}, incomingSignals);
    dataPromise.then(dataChannel => {
      //connection.reportConnection(true);
      dataChannel.onclose = () => {
	clearTimeout(timer);
	connection.close();
	delete testConnections[tag];
      };
      dataChannel.onmessage = event => dataChannel.send(event.data); // Just echo what we are given.
    });
  } else {
    //console.log('applying incoming signals');
    connection.signals = incomingSignals;
  }
  //console.log('awaiting response');
  const responseSignals = await Promise.race([connection.next, connection.dataChannelPromise]);
  connection.next = connection.signals;
  //console.log('responding', responseSignals.map(s => s[0]));
  res.send(responseSignals); // Send back our signalling answer+ice.
});

router.post('/data/echo/:tag', async (req, res, next) => { // Test endpoint for WebRTC.
  const {params, body} = req;
  const tag = params.tag;
  const incomingSignals = body;
  let connection = testConnections[tag];
  console.log('post connection:', !!connection, 'incoming:', incomingSignals.map(s => s[0]));
  if (!connection) {
    connection = testConnections[tag] = new WebRTCNG({label: tag});
    const timer = setTimeout(() => connection.close(), 15e3);
    console.log('created connection and applying', incomingSignals.map(s => s[0]));
    const promise = connection.signalsReady;
    const dataPromise = connection.dataChannelPromise = connection.ensureDataChannel('echo', {}, incomingSignals);
    dataPromise.then(dataChannel => {
      connection.reportConnection(true);
      dataChannel.onclose = () => {
	clearTimeout(timer);
	connection.close();
	delete testConnections[tag];
      };
      dataChannel.onmessage = event => dataChannel.send(event.data); // Just echo what we are given.
    });
    await promise;
    res.send(connection.signals);
    return;
  }
  console.log('applying incoming signals');
  res.send(await connection.respond(incomingSignals));
});

