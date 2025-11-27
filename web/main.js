import {
    loadTextToSpeech,
    loadVoiceStyle,
    writeWavFile
} from './helper.js';

// Configuration
const DEFAULT_VOICE_STYLE_PATH = 'assets/voice_styles/M1.json';

// Helper function to extract filename from path
function getFilenameFromPath(path) {
    return path.split('/').pop();
}

// Global state
let textToSpeech = null;
let cfgs = null;

// Pre-computed style
let currentStyle = null;
let currentStylePath = DEFAULT_VOICE_STYLE_PATH;

// UI Elements
const textInput = document.getElementById('text');
const voiceStyleSelect = document.getElementById('voiceStyleSelect');
const voiceStyleInfo = document.getElementById('voiceStyleInfo');
const totalStepInput = document.getElementById('totalStep');
const speedInput = document.getElementById('speed');
const generateBtn = document.getElementById('generateBtn');
const statusBox = document.getElementById('statusBox');
const statusText = document.getElementById('statusText');
const backendBadge = document.getElementById('backendBadge');
const resultsContainer = document.getElementById('results');
const errorBox = document.getElementById('error');
const pending = document.getElementById('pending');
const progressBar = document.getElementById('progress-bar');    
const playBtn = document.getElementById('play-btn');    
const pauseBtn = document.getElementById('pause-btn');   
const progressBarFilled = document.getElementById('progress-bar-filled');

let scheduledTime = 0;
const silenceDuration = 0.3;
let sampleRate = 0; // or set this when you know it

// 🔊 Web Audio setup for streaming playback
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioCtx();

let latestUrl = "";



function showStatus(message, type = 'info') {
    statusText.innerHTML = message;
    statusBox.className = 'status-box';
    if (type === 'success') {
        statusBox.classList.add('success');
    } else if (type === 'error') {
        statusBox.classList.add('error');
    }
}

function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('active');
}

function hideError() {
    errorBox.classList.remove('active');
}

function showBackendBadge() {
    backendBadge.classList.add('visible');
}

// Load voice style from JSON
async function loadStyleFromJSON(stylePath) {
    try {
        const style = await loadVoiceStyle([stylePath], true);
        return style;
    } catch (error) {
        console.error('Error loading voice style:', error);
        throw error;
    }
}

// Load models on page load
async function initializeModels() {
    try {
        showStatus('ℹ️ <strong>Loading configuration...</strong>');
        
        const basePath = 'assets/onnx';
        
        // Try WebGPU first, fallback to WASM
        let executionProvider = 'wasm';
        try {
            const result = await loadTextToSpeech(basePath, {
                executionProviders: ['webgpu'],
                graphOptimizationLevel: 'all'
            }, (modelName, current, total) => {
                showStatus(`ℹ️ <strong>Loading ONNX models (${current}/${total}):</strong> ${modelName}...`);
            });
            
            textToSpeech = result.textToSpeech;
            cfgs = result.cfgs;
            
            executionProvider = 'webgpu';
            backendBadge.textContent = 'WebGPU';
            backendBadge.style.background = '#4caf50';
        } catch (webgpuError) {
            console.log('WebGPU not available, falling back to WebAssembly');
            
            const result = await loadTextToSpeech(basePath, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            }, (modelName, current, total) => {
                showStatus(`ℹ️ <strong>Loading ONNX models (${current}/${total}):</strong> ${modelName}...`);
            });
            
            textToSpeech = result.textToSpeech;
            cfgs = result.cfgs;
        }
        
        showStatus('ℹ️ <strong>Loading default voice style...</strong>');
        
        // Load default voice style
        currentStyle = await loadStyleFromJSON(currentStylePath);
        voiceStyleInfo.textContent = `${getFilenameFromPath(currentStylePath)} (default)`;
        
        showStatus(`✅ <strong>Models loaded!</strong> Using ${executionProvider.toUpperCase()}. You can now generate speech.`, 'success');
        showBackendBadge();
        
        generateBtn.disabled = false;
        
    } catch (error) {
        console.error('Error loading models:', error);
        showStatus(`❌ <strong>Error loading models:</strong> ${error.message}`, 'error');
    }
}

// Handle voice style selection
voiceStyleSelect.addEventListener('change', async (e) => {
    const selectedValue = e.target.value;
    
    if (!selectedValue) return;
    
    try {
        generateBtn.disabled = true;
        showStatus(`ℹ️ <strong>Loading voice style...</strong>`, 'info');
        
        currentStylePath = selectedValue;
        currentStyle = await loadStyleFromJSON(currentStylePath);
        voiceStyleInfo.textContent = getFilenameFromPath(currentStylePath);
        
        showStatus(`✅ <strong>Voice style loaded:</strong> ${getFilenameFromPath(currentStylePath)}`, 'success');
        generateBtn.disabled = false;
    } catch (error) {
        showError(`Error loading voice style: ${error.message}`);
        
        // Restore default style
        currentStylePath = DEFAULT_VOICE_STYLE_PATH;
        voiceStyleSelect.value = currentStylePath;
        try {
            currentStyle = await loadStyleFromJSON(currentStylePath);
            voiceStyleInfo.textContent = `${getFilenameFromPath(currentStylePath)} (default)`;
        } catch (styleError) {
            console.error('Error restoring default style:', styleError);
        }
        
        generateBtn.disabled = false;
    }
});

// Call this once when you start a synthesis session
function initAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioCtx();
    scheduledTime = audioCtx.currentTime;
}

async function generateSpeech() {
    const text = textInput.value.trim();
    if (!text) {
        showError('Please enter some text to synthesize.');
        return;
    }
    
    if (!textToSpeech || !cfgs) {
        showError('Models are still loading. Please wait.');
        return;
    }
    
    if (!currentStyle) {
        showError('Voice style is not ready. Please wait.');
        return;
    }
    
    const startTime = Date.now();
    
    try {
        generateBtn.disabled = true;
        hideError();
        
        // Clear results and show placeholder
        resultsContainer.classList.add('hidden');
        pending.classList.remove('hidden');
        
        const totalStep = parseInt(totalStepInput.value);
        const speed = parseFloat(speedInput.value);
        const silenceDuration = 0.3;

        showStatus('ℹ️ <strong>Generating speech from text...</strong>');
        const tic = Date.now();

        // Make sure context is running (click on button counts as user gesture)
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        scheduledTime = audioCtx.currentTime; // when next chunk will start
        sampleRate = textToSpeech.sampleRate;
        
        // per-chunk playback helper
        const playChunk = ({ wav, duration, index, totalChunks }) => {
            if (!audioCtx) {
                initAudioContext();
            }

            // Build AudioBuffer from wav float array
            const buffer = audioCtx.createBuffer(1, wav.length, sampleRate);
            const channelData = buffer.getChannelData(0);
            for (let i = 0; i < wav.length; i++) {
                channelData[i] = wav[i];
            }

            const source = audioCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(audioCtx.destination);

            // Make sure we don’t schedule in the past
            const startAt = Math.max(audioCtx.currentTime, scheduledTime);

            // Schedule this chunk
            source.start(startAt);
            playBtn.classList.add('hidden');
            pauseBtn.classList.remove('hidden');

            // Reserve time for this chunk + silence
            scheduledTime = startAt + duration + silenceDuration;

            showStatus(
                `ℹ️ <strong>Playing chunk ${index + 1}/${totalChunks}...</strong>`
            );
        };

        // Call TTS with both progressCallback and chunkCallback
        const { wav, duration } = await textToSpeech.call(
            text,
            currentStyle,
            totalStep,
            speed,
            silenceDuration,
            (step, total) => {
                //showStatus(`ℹ️ <strong>Denoising (${step}/${total})...</strong>`);
            },
            playChunk 
        );
        
        const toc = Date.now();
        console.log(`Text-to-speech synthesis: ${((toc - tic) / 1000).toFixed(2)}s`);
        
        showStatus('ℹ️ <strong>Creating audio file...</strong>');

        // Full concatenated wav for final audio element + download
        const wavLen = Math.floor(textToSpeech.sampleRate * duration[0]);
        const wavOut = wav.slice(0, wavLen);
        
        // Create WAV file
        const wavBuffer = writeWavFile(wavOut, textToSpeech.sampleRate);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        
        // Calculate total time and audio duration
        const endTime = Date.now();
        const totalTimeSec = ((endTime - startTime) / 1000).toFixed(2);
        const audioDurationSec = duration[0].toFixed(2);
        
        // Display result with full text & replay/download controls
        resultsContainer.classList.remove('hidden');
        pending.classList.add('hidden');

        const inputTextDiv = document.getElementById('inputText');
        
        const totalTimeSecLabel = document.getElementById('totalTimeSecLabel');
        const audioLengthLabel = document.getElementById('audioLengthLabel');
        const audioElement = document.getElementById('audioElement');
        const audioSource = document.getElementById('audioSource');

        inputTextDiv.textContent = text;
        totalTimeSecLabel.textContent = `${totalTimeSec}s`;
        audioLengthLabel.textContent = `${audioDurationSec}s`;
        latestUrl = url;

        audioSource.src = url;
        audioElement.load();
        
        showStatus('✅ <strong>Speech synthesis completed successfully!</strong>', 'success');
        
    } catch (error) {
        console.error('Error during synthesis:', error);
        showStatus(`❌ <strong>Error during synthesis:</strong> ${error.message}`, 'error');
        showError(`Error during synthesis: ${error.message}`);
        
        // Restore placeholder
        resultsContainer.innerHTML = `
            <div class="results-placeholder">
                <div class="results-placeholder-icon">🎤</div>
                <p>Generated speech will appear here</p>
            </div>
        `;
    } finally {
        generateBtn.disabled = false;
    }
}

// Download handler (make it global so it can be called from onclick)
window.downloadAudio = function(filename) {
    const a = document.createElement('a');
    a.href = latestUrl;
    a.download = filename;
    a.click();
};

// Attach generate function to button
generateBtn.addEventListener('click', generateSpeech);

// Initialize on load
window.addEventListener('load', async () => {
    generateBtn.disabled = true;
    await initializeModels();
});

window.playAudio = async function (pause) {
    if (!audioCtx) {
        initAudioContext();
    }

    if (!pause) {
        // PLAY (resume context)
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        playBtn.classList.add('hidden');
        pauseBtn.classList.remove('hidden');
    } else {
        // PAUSE (suspend context)
        if (audioCtx.state === 'running') {
            await audioCtx.suspend();
        }
        pauseBtn.classList.add('hidden');
        playBtn.classList.remove('hidden');
    }
};
