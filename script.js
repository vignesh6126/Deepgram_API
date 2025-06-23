const DEEPGRAM_API_KEY = import.meta.env.VITE_DEEPGRAM_API_KEY;

if (!DEEPGRAM_API_KEY) {
    alert('⚠️ Please set your Deepgram API key in the .env file.');
}

const DEEPGRAM_ENDPOINT_BASE = 'wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true';

const audioFileInput = document.getElementById('audioFile');
const uploadBtn = document.getElementById('uploadBtn');
const recordBtn = document.getElementById('recordBtn');
const transcript = document.getElementById('transcript');
const statusElement = document.getElementById('status');

let isRecording = false;
let socket = null;
let mediaStream = null;
let audioContext = null;

uploadBtn.addEventListener('click', async () => {
    const file = audioFileInput.files[0];
    if (!file) {
        alert('Please select an audio file first!');
        return;
    }

    transcript.value = '';
    statusElement.textContent = 'Transcribing...';
    console.log('📁 Uploading audio file for transcription...');

    try {
        const result = await transcribeAudioFile(file);
        transcript.value = result;
        statusElement.textContent = 'Transcription complete!';
        console.log('✅ Final transcript:', result);
    } catch (err) {
        console.error(err);
        statusElement.textContent = 'Error during transcription.';
    }
});

async function transcribeAudioFile(file) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(DEEPGRAM_ENDPOINT_BASE, ['token', DEEPGRAM_API_KEY]);
        let transcriptText = '';

        socket.binaryType = 'arraybuffer';

        socket.onopen = () => {
            console.log('✅ WebSocket connected for file upload');
            const reader = new FileReader();
            reader.onload = () => {
                socket.send(new Uint8Array(reader.result));
                socket.send(new Uint8Array()); // Send zero byte to signal end
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                const text = data.channel?.alternatives[0]?.transcript;
                if (text) {
                    transcriptText += text + ' ';
                    console.log('📝 File Transcript Chunk:', text);
                }
            } catch (err) {
                console.error('❌ Error parsing message:', err);
            }
        };

        socket.onerror = (error) => reject('WebSocket error: ' + error.message);

        socket.onclose = (event) => {
            console.log('🔒 WebSocket closed:', event.reason);
            resolve(transcriptText.trim());
        };
    });
}

// 🎙️ Live Microphone Transcription
recordBtn.addEventListener('click', async () => {
    if (isRecording) {
        await stopRecording();
    } else {
        await startRecording();
    }
});

async function startRecording() {
    try {
        isRecording = true;
        transcript.value = '';
        recordBtn.textContent = '⏹️ Stop Recording';
        statusElement.textContent = 'Listening...';
        console.log('🎙️ Starting live microphone transcription...');

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioContext.createMediaStreamSource(mediaStream);

        socket = new WebSocket(DEEPGRAM_ENDPOINT_BASE, ['token', DEEPGRAM_API_KEY]);
        socket.binaryType = 'arraybuffer';

        socket.onopen = () => {
            console.log('✅ WebSocket connected for live transcription');
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            source.connect(processor);
            processor.connect(audioContext.destination);

            processor.onaudioprocess = (event) => {
                const input = event.inputBuffer.getChannelData(0);
                const buffer = convertTo16BitPCM(input);
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(buffer);
                    console.log('🎧 Sending audio chunk to Deepgram');
                }
            };
        };

        socket.onclose = () => {
            console.log('🔒 WebSocket closed');
            stopRecording();
        };

        socket.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    console.log('📩 Message from Deepgram:', data);

    const transcriptData = data.channel?.alternatives?.[0]?.transcript;
    if (transcriptData && transcriptData.length > 0) {
      console.log('📝 Live Transcript Chunk:', transcriptData);
      transcript.value += (transcript.value ? ' ' : '') + transcriptData;
      transcript.scrollTop = transcript.scrollHeight;
    }
  } catch (err) {
    console.error('❌ Failed to parse transcript:', err);
  }
};


        socket.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            stopRecording();
        };

        socket.onclose = () => {
            console.log('🔒 WebSocket closed');
            stopRecording();
        };
    } catch (err) {
        console.error('❌ Error starting recording:', err);
        stopRecording();
    }
}

async function stopRecording() {
    isRecording = false;
    recordBtn.textContent = '🎙️ Start Recording';
    statusElement.textContent = 'Recording stopped.';

    if (socket) {
        socket.close();
        socket = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    if (audioContext) {
        await audioContext.close();
        audioContext = null;
    }
}

function convertTo16BitPCM(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array.buffer;
}
