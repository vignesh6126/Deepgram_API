// Start with empty string; will override if env var is present
let DEEPGRAM_API_KEY = '';

// Deepgram websocket URL base (no token here)
const DEEPGRAM_ENDPOINT_BASE = 'wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true';

const micButton = document.getElementById('micButton');
const transcript = document.getElementById('transcript');
const statusElement = document.getElementById('status');

let isListening = false;
let socket = null;
let mediaStream = null;
let audioContext = null;

async function initApp() {
  // Override API key if environment variable is set (works with Vite)
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    DEEPGRAM_API_KEY = import.meta.env.VITE_DEEPGRAM_API_KEY || DEEPGRAM_API_KEY;
  }

  if (!DEEPGRAM_API_KEY) {
    showKeyError();
    return;
  }

  micButton.disabled = false;
  micButton.addEventListener('click', toggleListening);
  updateUI('ready');
}

async function toggleListening() {
  if (isListening) {
    await stopListening();
  } else {
    await startListening();
  }
}

async function startListening() {
  try {
    isListening = true;
    updateUI('starting');

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
        channelCount: 1,
      },
      video: false,
    });

    // Build the full Deepgram websocket URL
    // Token passed as a subprotocol in WebSocket constructor
    socket = new WebSocket(DEEPGRAM_ENDPOINT_BASE, ['token', DEEPGRAM_API_KEY]);

    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
      console.log('✅ WebSocket connected');
      updateUI('listening');
      setupAudioProcessing();
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.channel?.alternatives[0]?.transcript && data.is_final) {
          const text = data.channel.alternatives[0].transcript.trim();
          console.log('✅ Final Transcript:', text);
          transcript.value += (transcript.value ? ' ' : '') + text;
          transcript.scrollTop = transcript.scrollHeight;
        }
      } catch (err) {
        console.error('Error parsing message:', err);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      updateUI('error', 'WebSocket error occurred');
      stopListening();
    };

    socket.onclose = (event) => {
      console.log('WebSocket closed:', event.reason);
      if (isListening) {
        updateUI('error', 'Connection closed');
        stopListening();
      }
    };
  } catch (err) {
    console.error('Start listening failed:', err);
    updateUI('error', err.message);
    stopListening();
  }
}

function setupAudioProcessing() {
  try {
    const source = audioContext.createMediaStreamSource(mediaStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        const audioData = event.inputBuffer.getChannelData(0);
        const raw = convertTo16BitPCM(audioData);
        socket.send(raw);
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  } catch (err) {
    console.error('Audio processing setup error:', err);
    updateUI('error', 'Audio setup failed');
    stopListening();
  }
}

async function stopListening() {
  isListening = false;

  if (socket) {
    socket.close();
    socket = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  if (audioContext) {
    if (audioContext.state !== 'closed') {
      await audioContext.close();
    }
    audioContext = null;
  }

  updateUI('ready');
}

function convertTo16BitPCM(float32Array) {
  const int16Buffer = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Buffer.buffer;
}

function updateUI(state, message) {
  switch (state) {
    case 'starting':
      micButton.textContent = 'Initializing...';
      micButton.disabled = true;
      statusElement.textContent = 'Setting up...';
      break;
    case 'listening':
      micButton.textContent = '🛑 Stop Listening';
      micButton.disabled = false;
      statusElement.textContent = message || 'Listening...';
      break;
    case 'ready':
      micButton.textContent = '🎤 Start Listening';
      micButton.disabled = false;
      statusElement.textContent = message || 'Ready when you are';
      break;
    case 'error':
      micButton.textContent = '🎤 Start Listening';
      micButton.disabled = false;
      statusElement.textContent = message || 'Error occurred';
      statusElement.style.color = '#ff5555';
      setTimeout(() => (statusElement.style.color = ''), 2000);
      break;
  }
}

function showKeyError() {
  statusElement.textContent = '⚠️ Please configure your Deepgram API key';
  statusElement.style.color = '#ff5555';
  micButton.disabled = true;
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', initApp);

// Clean up on unload
window.addEventListener('beforeunload', () => {
  if (isListening) stopListening();
});
