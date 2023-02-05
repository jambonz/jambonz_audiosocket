const express = require('express');
const fs = require('fs');
const app = express();
const logger = require('pino')({level: process.env.LOGLEVEL || 'info'});

// eslint-disable-next-line no-unused-vars
const expressWs = require('express-ws')(app);
const wavHeaders = require('wav-headers');
const port = process.env.PORT || 3000;

// Serve the JSON verbs to an answer webhook
app.post('/answer', (req, res) => {
  const data = [
    {
      verb: 'say',
      text: 'Connecting to Socket'
    }, {
      verb: 'listen',
      url: '/socket',
      passDtmf: true
    }
  ];
  res.json(data);
});

// Playback hello.wav to each connected call
app.get('/hello', (req, res) => {
  //Read the wav file and encode as base64
  const audioContent = fs.readFileSync('digits/hello.wav', 'base64');

  // Build the JSON message containing the audio and metadata
  const playAudioData = JSON.stringify({
    type: 'playAudio',
    data: {
      audioContent: audioContent,
      audioContentType: 'wav',
      sampleRate: '8000',
    },
  });

  // Iterate over connected calls and send object
  for (const [id, conn] of Object.entries(calls)) {
    logger.debug(id); // Log call Sid
    conn.send(playAudioData);
  }
  res.send('ok');
});

const calls = {};

// Handle the WebSocket Connection
app.ws('/socket', function(conn, req) {
  logger.info('socket Connected');
  conn.on('message', function(msg) {
    if (typeof msg != 'string') { // These are the binary messages containing the call audio
      const newBuffer = Buffer.concat([conn.callBuffer, msg]); // append the call audio to the call buffer
      conn.callBuffer = newBuffer; //write the new buffer to the conn object
    } else {
      const data = JSON.parse(msg);
      if ('callSid' in data) { //This is the initial message for a new call
        conn.calldata = data; // Store the call data against the conn object
        conn.callBuffer = Buffer.alloc(640); // allocate a buffer on the conn object to record the audio to
        calls[data.callSid] = conn; // Add the connection to the calls object keyed by callSid
        logger.debug({data}, 'received initial message');
      }
      else if ('event' in data) { //This is a dtmf event message
        //Read the wav file and encode as base64
        const audioContent = fs.readFileSync(`digits/${data.dtmf}.wav`, 'base64');
        const playAudioData = JSON.stringify({
          type: 'playAudio',
          data: {
            audioContent: audioContent,
            audioContentType: 'wav',
            sampleRate: '8000',
          },
        }); // Build the JSON message containing the audio and metadata
        conn.send(playAudioData); // Write the message to the Socket
      }
      else {
        //These are other notification messages about the playback completing of the sent audio
        logger.debug({msg}, 'unhandled message');
      }
    }
  });
  conn.on('close', function() {
    // When the websocket is closed the call is ended, we will now write the buffered RAW audio to a WAV file.
    logger.info('socket closed');
    delete calls[conn.calldata.callSid]; // Remove the connection from the calls object
    //Specify the WAV header data based on the contents of the inital message
    const options = {
      channels: conn.calldata.mixType === 'mono' ? 1 : 2,
      sampleRate: conn.calldata.sampleRate,
      bitDepth: 16,
      dataLength: conn.callBuffer.length
    };
    // Generate WAV header data buffer
    const headersBuffer = wavHeaders (options);
    //Combine the wav header with the raw audio buffer
    const fullBuffer = Buffer.concat([ headersBuffer, conn.callBuffer ]);
    const stream = fs.createWriteStream(`Recordings/${conn.calldata.callSid}.wav`);
    stream.write(fullBuffer, function() {
      stream.end();
    });
  });
});

app.listen(port, () => {
  logger.info(`jambonz_websocket app listening on port ${port}`);
});
