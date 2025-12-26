
## Data channel name event

RTCPeerConnection defines a 'datachannel' event, and RTCDataChannel defines an 'open' event, but it is difficult to use them correctly:
- 'datachannel' fires only for one side of a connection, and only when negotiated:false. 
- To listen for 'open', you must already have the data channel. Not all implementations fire a handler for this when assigned in a 'datachannel' handler, and it can fire multiple times for the same channel name when two sides initiate the channel simultaneously with negotiated:true.

## close event

RTCPeerConnection defines a 'signalingstatechange' event in which application handlers can fire code when aPeerConnection.readyState === 'closed', but this not particuarly convenient.
