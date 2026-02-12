# @yz-social/webrtc

A wrapper around either the browser's WebRTC, or around @roamhq/wrtc on NodeJS.

Installing this package in NodeJS - i.e., with `npm install` in either this package's directory or in some other module that imports this - will install the @roamhq/wrtc dependency. Succesfully installing _that_ may require extra C++ tools on the host system. 

For example, during the Windows installation of NodeJS (prior to installing this package), you may be asked whether to install the additional tools for VC++, including Chocalety. You should check the box to install them, and follow those directions. Installing those tools will occur in a separate window, prompt for proceeding, and may take a very long time to execute.


## Some Tweaks

See the test cases and spec/ports.js for examples.

### Semi-trickled ice

RTCPeerConnection generates a bunch of ICE candidates right away, and then more over the next few seconds. It can be a while before it is finished. In this package, we have utilities to collect signals as they occur, and then gather them for sending while accumulating a new set of signals to be sent.

### Simultaneous outreach

Things can get confused if two nodes try to connect to each other at the same time. There is supposed to be some automatic rollback mechanism, but implementations vary. This code tries to sort that out, if the applicaiton can label one of the pair to be "polite" and the other not. 

### Data channel name event

RTCPeerConnection defines a 'datachannel' event, and RTCDataChannel defines an 'open' event, but it is difficult to use them correctly:
- 'datachannel' fires only for one side of a connection, and only when negotiated:false. 
- To listen for 'open', you must already have the data channel. Not all implementations fire a handler for this when assigned in a 'datachannel' handler, and it can fire multiple times for the same channel name when two sides initiate the channel simultaneously with negotiated:true.

### close event

RTCPeerConnection defines a 'signalingstatechange' event in which application handlers can fire code when aPeerConnection.readyState === 'closed', but this not particuarly convenient.
