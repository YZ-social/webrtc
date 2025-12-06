import express from 'express';
import { WebRTC } from '../index.js';
export const router = express.Router();
 
 const testConnections = {}; // Is it really necessary to keep these around, against garbage collection?
router.post('/data/echo/:tag', async (req, res, next) => { // Test endpoint for WebRTC.
  const {params, body} = req;
  const tag = params.tag;
  let incomingSignals = body;
  let connection = testConnections[tag];
  if (!connection) {
    connection = testConnections[tag] = new WebRTC({label: tag});
    const timer = setTimeout(() => connection.close(), 15e3); // Enough to complete test, then cleanup.
    const dataPromise = connection.dataChannelPromise = connection.ensureDataChannel('echo', {}, incomingSignals);
    incomingSignals = [];
    dataPromise.then(dataChannel => {
      dataChannel.onclose = () => {
	clearTimeout(timer);
	connection.close();
	delete testConnections[tag];
      };
      dataChannel.onmessage = event => dataChannel.send(event.data); // Just echo what we are given.
    });
  }
  res.send(await connection.respond(incomingSignals));
});

