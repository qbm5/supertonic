<template>
    <div class="result-player">
        <div class="playback">
            <button id="reset-btn" class="player-btn min" @click="resetAction()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
                    focusable="false">
                    <path
                        d="M12 5V2L7 6l5 4V7c3.31 0 6 2.69 6 6a6 6 0 1 1-12 0H4c0 4.42 3.58 8 8 8s8-3.58 8-8a8 8 0 0 0-8-8z" />
                </svg>
            </button>

            <button id="play-btn" class="player-btn min" :class="{ hidden: isPlaying }" @click="playAction()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
                    focusable="false">
                    <path d="M8 5v14l11-7-11-7z"></path>
                </svg>
            </button>

            <button id="pause-btn" class="player-btn min" :class="{ hidden: !isPlaying }" @click="pauseAction()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
                    focusable="false">
                    <path d="M8 6h3v12H8V6zm5 0h3v12h-3V6z"></path>
                </svg>
            </button>

            <div id="progress-bar" class="progress-bar fl-10" @click="onProgressClick">
                <div id="progress-bar-filled" class="progress-bar-filled" :style="{ width: progressPercent + '%' }">
                </div>
            </div>
            <div class="timers">{{ totalPlayedSoFar.toFixed(2) }} / {{ totalDurationSoFar.toFixed(2) }}</div>
        </div>

        <!-- Hidden audio element for final file, only used for debugging purposes -->
        <audio class="hidden" controls id="audioElement" ref="audioElement" :src="latestUrl || undefined">
            <source id="audioSource" type="audio/wav" />
        </audio>
    </div>


</template>

<script setup lang="ts">
import { ref } from 'vue';

let progressPercent = ref(0);
let totalPlayedSoFar = ref(0);
let totalDurationSoFar = ref(0);
let isPlaying = ref(false);
let scheduledTime = ref(0);
let fullBuffer: AudioBuffer | null = null;
let playedOffset = 0;
let lastPlayWallClock = null as null | number;
let currentSource: AudioBufferSourceNode | null = null;

const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
let audioCtx: AudioContext | null = null;

let combinedSamples: Float32Array | null = null;
let chunkSources: AudioBufferSourceNode[] = []; // track all sources for stopping


const props = defineProps({
    latestUrl: String,
    sampleRate: { type: Number, default: 44100, required: true },
    silenceDuration: { type: Number, default: 0.3, required: false },
});

const emits = defineEmits({
    showStatus: (message: string, type: 'info' | 'success' | 'error') => true,
})

async function playAction() {
    const ctx = ensureAudioContext();
    if (ctx.state === 'suspended') {
        await ctx.resume();
    }
    if (!isPlaying.value) {
        lastPlayWallClock = performance.now();
        isPlaying.value = true;
    }
}

async function pauseAction() {
    const ctx = ensureAudioContext();
    if (ctx.state === 'running') {
        await ctx.suspend();
    }

    if (isPlaying.value && lastPlayWallClock !== null) {
        playedOffset += (performance.now() - lastPlayWallClock) / 1000.0;
        lastPlayWallClock = null;
    }

    isPlaying.value = false;
}

function resetAction() {
    stopCurrentSource();
    resetPlaybackState();
    seekTo(0);
}


async function playChunk(chunk: { wav: any; duration: number; index: number; totalChunks: number; }) {
  const context = ensureAudioContext();

  const chunkArray = chunk.wav instanceof Float32Array
    ? chunk.wav
    : new Float32Array(chunk.wav as number[]);

  if (!combinedSamples) {
    combinedSamples = chunkArray;
  } else {
    const tmp = new Float32Array(combinedSamples.length + chunkArray.length);
    tmp.set(combinedSamples, 0);
    tmp.set(chunkArray, combinedSamples.length);
    combinedSamples = tmp;
  }

  fullBuffer = context.createBuffer(1, combinedSamples.length, props.sampleRate || 44100);
  fullBuffer.getChannelData(0).set(combinedSamples);

  const chunkBuffer = context.createBuffer(1, chunkArray.length, props.sampleRate || 44100);
  chunkBuffer.getChannelData(0).set(chunkArray);

  const source = context.createBufferSource();
  source.buffer = chunkBuffer;
  source.connect(context.destination);
  chunkSources.push(source);

  const startAt = Math.max(context.currentTime, scheduledTime.value);
  source.start(startAt);

  const chunkTotalDuration = chunk.duration + (props.silenceDuration || 0);
  scheduledTime.value = startAt + chunkTotalDuration;

  if (chunk.index === chunk.totalChunks - 1) {
    totalDurationSoFar.value += chunk.duration;
  } else {
    totalDurationSoFar.value += chunkTotalDuration;
  }

  if (chunk.index === 0 && !isPlaying.value) {
    isPlaying.value = true;
    lastPlayWallClock = performance.now();
    audioCtx?.resume?.();
  }

  emits(
    'showStatus',
    `ℹ️ <strong>Loading chunk ${chunk.index + 1}/${chunk.totalChunks}...</strong>`,
    'info'
  );
}

function ensureAudioContext(): AudioContext {
    if (!audioCtx) {
        audioCtx = new AudioCtx();
        scheduledTime.value = audioCtx.currentTime;
    }
    return audioCtx;
}


function stopCurrentSource() {
     if (currentSource) {
    try { currentSource.stop(); } catch {}
    currentSource.disconnect();
    currentSource = null;
  }
  for (const src of chunkSources) {
    try { src.stop(); } catch {}
    src.disconnect();
  }
  chunkSources = [];
}

function onProgressClick(e: MouseEvent) {
  if (totalDurationSoFar.value <= 0 || !fullBuffer) return;

  const progressBar = e.currentTarget as HTMLElement;
  const rect = progressBar.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickRatio = clickX / rect.width;
  const seekTime = clickRatio * totalDurationSoFar.value;

  // update timer base
  playedOffset = seekTime;
  if (isPlaying.value) {
    lastPlayWallClock = performance.now();
  }

  stopCurrentSource();   // kill any scheduled chunk playback
  void seekTo(seekTime);
}


function resetPlaybackState() {
    totalDurationSoFar.value = 0;
    playedOffset = 0;
    lastPlayWallClock = null;
    isPlaying.value = false;
    progressPercent.value = 0;
    totalPlayedSoFar.value = 0;
}

function updateProgressBar() {
    let currentPlayed = playedOffset;

    if (isPlaying.value && lastPlayWallClock !== null) {
        const elapsedMs = performance.now() - lastPlayWallClock;
        currentPlayed += elapsedMs / 1000.0;
    }

    totalPlayedSoFar.value = currentPlayed;

    if (totalDurationSoFar.value > 0) {
        const ratio = Math.min(currentPlayed / totalDurationSoFar.value, 1);
        progressPercent.value = ratio * 100;
    } else {
        progressPercent.value = 0;
    }

    if (currentPlayed >= totalDurationSoFar.value && totalDurationSoFar.value > 0) {
        // reached the end
        
        isPlaying.value = false;
        playedOffset = 0;
        lastPlayWallClock = null;
        seekTo(0);
        pauseAction();
    }

    requestAnimationFrame(updateProgressBar);
}


async function seekTo(targetSeconds: number) {
    const ctx = ensureAudioContext();
    if (!fullBuffer) return;

    const duration = fullBuffer.duration;
    const clamped = Math.min(Math.max(targetSeconds, 0), duration);

    // reset timers
    playedOffset = clamped;
    lastPlayWallClock = performance.now();
    totalDurationSoFar.value = duration;

    // ensure audio context is running
    if (ctx.state === 'suspended') {
        await ctx.resume();
    }

    isPlaying.value = true;

    // restart source from offset
    stopCurrentSource();
    const source = ctx.createBufferSource();
    source.buffer = fullBuffer;
    source.connect(ctx.destination);

    // start immediately at clamped offset
    source.start(0, clamped);
    currentSource = source;
}

updateProgressBar();


defineExpose({
    playChunk,
    stopCurrentSource,
    resetPlaybackState
});

</script>