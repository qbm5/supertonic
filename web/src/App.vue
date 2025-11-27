<template>
  <div class="container">
    <h1>🎤 Supertonic</h1>
    <p class="subtitle">Text-to-Speech with ONNX Runtime Web</p>

    <div :class="['status-box', statusType]">
      <div class="status-text-wrapper">
        <div id="statusText" v-html="statusHtml"></div>
      </div>
      <div v-if="backendBadgeText" id="backendBadge" :class="['backend-badge']"
        :style="{ background: backendBadgeColor }">
        {{ backendBadgeText }}
      </div>
    </div>

    <div class="main-content">
      <!-- LEFT PANEL -->
      <div class="left-panel">
        <div class="section">
          <div class="ref-audio-label">
            <label for="voiceStyleSelect">Voice Style: </label>
            <span id="voiceStyleInfo" class="ref-audio-info">
              {{ voiceStyleInfo }}
            </span>
          </div>
          <select id="voiceStyleSelect" v-model="currentStylePath" @change="onVoiceStyleChange">
            <option v-for="voicePath in voicePaths" :key="voicePath.value" :value="voicePath.value">
              {{ voicePath.label }}
            </option>            
          </select>
        </div>

        <div class="section">
          <label for="text">Text to Synthesize:</label>
          <textarea id="text" v-model="text" placeholder="Enter the text you want to convert to speech..."></textarea>
        </div>

        <div class="params-grid">
          <div class="section">
            <label for="totalStep">Total Steps (higher = better quality):</label>
            <input type="number" id="totalStep" v-model.number="totalStep" min="1" max="50" />
          </div>

          <div class="section">
            <label for="speed">Speed (0.9-1.5 recommended):</label>
            <input type="number" id="speed" v-model.number="speed" min="0.5" max="2.0" step="0.05" />
          </div>
        </div>

        <button id="generateBtn" :disabled="isGenerating || initializing" @click="generateSpeech">
          {{ isGenerating ? 'Generating…' : 'Generate Speech' }}
        </button>

        <div id="error" class="error" :class="{ active: !!errorText }">
          {{ errorText }}
        </div>
      </div>

      <div class="right-panel">
        <div id="pending" class="results" :class="{ hidden: showResults }">
          <div class="results-placeholder">
            <div class="results-placeholder-icon">🎤</div>
            <p>Generated speech will appear here</p>
          </div>
        </div>

        <div id="results" class="results" :class="{ hidden: !showResults }">
          <div class="result-item">
            <div class="result-text-container">
              <div class="result-text-label">Input Text</div>
              <div id="inputText" class="result-text">
                {{ inputText }}
              </div>
            </div>
            <div class="result-info">
              <div class="info-item">
                <span>📊 Audio Length</span>
                <strong id="audioLengthLabel">{{ audioLengthLabel }}</strong>
              </div>
              <div class="info-item">
                <span>⏱️ Generation Time</span>
                <strong id="totalTimeSecLabel">{{ totalTimeLabel }}</strong>
              </div>
              <div class="info-item">
                <span>🔢 Number of Chunks</span>
                <strong id="numberOfChunksLabel">{{ numberOfChunks }}</strong>
              </div>
            </div>

            <div class="result-player">             
              <audio-player ref="audioPlayerComponent" @show-status="showStatus"
              :latestUrl="latestUrl" :sample-rate="sampleRate" :silence-duration="silenceDuration" />
            </div>
            

            <div class="result-actions">
              <button @click="downloadAudio('synthesized_speech.wav')" :disabled="!latestUrl">
                <span>⬇️</span>
                <span>Download WAV</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { WorkerOutMessage } from "./ttsWorker";
import AudioPlayer from './components/audio-player.vue';
const audioPlayerComponent = ref<InstanceType<typeof AudioPlayer> | null>(null);
const ttsWorker = new Worker(
  new URL("./ttsWorker.ts", import.meta.url),
  { type: "module" }
);


const voicePaths = [
  { value: 'assets/voice_styles/M1.json', label: 'Male 1 (M1)' },
  { value: 'assets/voice_styles/M2.json', label: 'Male 2 (M2)' },
  { value: 'assets/voice_styles/F1.json', label: 'Female 1 (F1)' },
  { value: 'assets/voice_styles/F2.json', label: 'Female 2 (F2)' },]

const DEFAULT_VOICE_STYLE_PATH = 'assets/voice_styles/M1.json';

// ---- reactive UI state ----
const text = ref(
  'This morning, I took a walk in the park, and the sound of the birds and the breeze was so pleasant that I stopped for a long time just to listen.'
);
const totalStep = ref<number>(5);
const speed = ref<number>(1.05);

const statusHtml = ref<string>('ℹ️ <strong>Loading models...</strong> Please wait...');
const statusType = ref<'info' | 'success' | 'error'>('info');
const backendBadgeText = ref<string>('');
const backendBadgeColor = ref<string>('#666');
const backendVisible = ref<boolean>(false);

const errorText = ref<string>('');
const showResults = ref<boolean>(false);
const inputText = ref<string>('');
const totalTimeLabel = ref<string>('0s');
const audioLengthLabel = ref<string>('0s');


const currentStylePath = ref<string>(DEFAULT_VOICE_STYLE_PATH);
const voiceStyleInfo = ref<string>('Loading...');

const latestUrl = ref<string>('');
const isGenerating = ref<boolean>(false);
const initializing = ref<boolean>(false);
const numberOfChunks = ref<number>(0);


const audioElement = ref<HTMLAudioElement | null>(null);

let sampleRate = 0;
const silenceDuration = 0.3;

  


function showStatus(message: string, type: 'info' | 'success' | 'error' = 'info') {
  statusHtml.value = message;
  statusType.value = type;
}

function showError(message: string) {
  errorText.value = message;
}

function hideError() {
  errorText.value = '';
}

function showBackendBadge() {
  backendVisible.value = true;
}

function getFilenameFromPath(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

ttsWorker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'showStatus':
      showStatus(message.text, message.statusType);
      break;
    case 'updateConfigInfo':
      sampleRate = message.rate;
      backendBadgeText.value = message.provider;
      backendBadgeColor.value = message.provider === 'WebGPU' ? '#4CAF50' : '#666';
      initializing.value = false;
      break;
    case 'updateGeneratedUrl':
      latestUrl.value = message.url;
      totalTimeLabel.value = message.totalTime;
      audioLengthLabel.value = message.audioDuration;
      if (audioElement.value) {
        audioElement.value.load();
      }
      showResults.value = true;
      isGenerating.value = false;
      break;
    case 'streamChunk':
      audioPlayerComponent.value?.playChunk(message.chunk)
      showResults.value = true;
      numberOfChunks.value += 1;
      break;
    default:
      console.warn('Unknown message from TTS Worker:', message);
      break;
  }
};

// Initialize models (on mount)
async function initializeModels() {
  initializing.value = true;
  if(ttsWorker) {
    ttsWorker.postMessage({
      type: 'init',
      currentStylePath: currentStylePath.value
    });
    backendBadgeColor.value = '#666';
    voiceStyleInfo.value = `${getFilenameFromPath(currentStylePath.value)} (default)`;  
    showBackendBadge();
    isGenerating.value = false;
  }
  else{
    console.error('TTS Worker not initialized');  
  }
}

async function onVoiceStyleChange() {
  const selectedValue = currentStylePath.value;
  if (!selectedValue) return;

  try {
    isGenerating.value = true;
    ttsWorker.postMessage({
      type: 'changeVoice',
      currentStylePath: selectedValue
    });
    voiceStyleInfo.value = getFilenameFromPath(selectedValue);

    
  } catch (error: any) {
    showError(`Error loading voice style: ${error.message}`);

    // restore default style
    currentStylePath.value = DEFAULT_VOICE_STYLE_PATH;
    try {
        ttsWorker.postMessage({
        type: 'changeVoice',
        currentStylePath: currentStylePath.value
      });
      voiceStyleInfo.value = `${getFilenameFromPath(currentStylePath.value)} (default)`;
    } catch (styleError) {
      console.error('Error restoring default style:', styleError);
    }
  } finally {
    isGenerating.value = false;
  }
}

async function generateSpeech() {
  const txt = text.value.trim();
  latestUrl.value = '';
  numberOfChunks.value = 0;
  // reset current buffer
  audioPlayerComponent.value?.stopCurrentSource();
  audioPlayerComponent.value?.resetPlaybackState();
  if (!txt) {
    showError('Please enter some text to synthesize.');
    return;
  }

  try {
    isGenerating.value = true;
    hideError();

    showResults.value = false;

    showStatus('ℹ️ <strong>Generating speech from text...</strong>', 'info');

    const totalStepValue = totalStep.value;
    const speedValue = speed.value;

    
    inputText.value = txt;

    ttsWorker.postMessage({
      type: 'generateSpeech',
      text: txt,
      totalStep: totalStepValue,
      speed: speedValue,
      silenceDuration: silenceDuration,
    });
  } catch (error: any) {
    console.error('Error during synthesis:', error);
    showStatus(`❌ <strong>Error during synthesis:</strong> ${error.message}`, 'error');
    showError(`Error during synthesis: ${error.message}`);
    showResults.value = false;
  } finally {
  }
}

function downloadAudio(filename: string) {
  if (!latestUrl.value) return;
  const a = document.createElement('a');
  a.href = latestUrl.value;
  a.download = filename;
  a.click();
}


onMounted(async () => {
  isGenerating.value = true;
  await initializeModels();
  
});
</script>
