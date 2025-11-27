import { loadTextToSpeech, loadVoiceStyle, TextToSpeech, Style, writeWavFile } from './helpers/helper';


const ctx: DedicatedWorkerGlobalScope = self as any;

export type WorkerInMessage =
    | { type: 'init'; currentStylePath: string }
    | { type: "changeVoice", currentStylePath: string }
    | { type: 'generateSpeech'; text: string; totalStep: number, speed: number, silenceDuration: number }
    

export type WorkerOutMessage =
    | { type: 'showStatus'; text: string, statusType: 'info' | 'success' | 'error' }
    | { type: 'updateConfigInfo'; rate: number, provider: string }
    | { type: 'updateGeneratedUrl'; url: string, totalTime: string, audioDuration: string }
    | {type: 'streamChunk'; chunk: { wav: any; duration: number; index: number; totalChunks: number;} };

let ttsEngine: TextToSpeech | null = null;
let cfgs: any = null;
let currentStyle: Style | null = null;
let sampleRate: number = 22050;

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
    const message = event.data;
    switch (message.type) {
        case 'changeVoice':
            showStatus('ℹ️ <strong>Loading voice style...</strong>', 'info');
            currentStyle = await loadStyleFromJSON(message.currentStylePath);
            showStatus(
                `✅ <strong>Voice style loaded:</strong> ${getFilenameFromPath(message.currentStylePath)}`,
                'success'
            );
            break;
        case 'generateSpeech':
            if (!ttsEngine || !cfgs || !currentStyle) {
                showStatus('❌ <strong>Cannot generate speech:</strong> Models or voice style not loaded.', 'error');
                return;
            }
            const tic = Date.now();
            const result: { wav: any; duration: number[] } = await
                ttsEngine.call(
                    message.text,
                    currentStyle,
                    message.totalStep,
                    message.speed,
                    message.silenceDuration,
                    null,
                    playChunk
                );

            const toc = Date.now();
            console.log(`Text-to-speech synthesis: ${((toc - tic) / 1000).toFixed(2)}s`);

            showStatus('ℹ️ <strong>Creating audio file...</strong>', 'info');

            const wav = result.wav;
            const durationArr = result.duration;

            const wavLen = Math.floor(sampleRate * durationArr[0]!);
            const wavOut = wav.slice(0, wavLen);

            const wavBuffer = writeWavFile(wavOut, sampleRate);
            const blob = new Blob([wavBuffer], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);

            const endTime = Date.now();
            const totalTimeSec = ((endTime - tic) / 1000).toFixed(2);
            const audioDurationSec = durationArr[0]!.toFixed(2);

            const outMessage: WorkerOutMessage = {
                type: 'updateGeneratedUrl',
                url,
                totalTime: totalTimeSec,
                audioDuration: audioDurationSec
            };

            self.postMessage(outMessage);
            showStatus('✅ <strong>Speech synthesis completed successfully!</strong>', 'success');
            break;
        case 'init':
            try {
                showStatus('ℹ️ <strong>Loading configuration...</strong>', 'info');

                const basePath = '../assets/onnx';

                let executionProvider: 'webgpu' | 'wasm' = 'wasm';

                try {
                    const result = await loadTextToSpeech(
                        basePath,
                        {
                            executionProviders: ['webgpu'],
                            graphOptimizationLevel: 'all',
                        },
                        (modelName: string, current: number, total: number) => {
                            showStatus(
                                `ℹ️ <strong>Loading ONNX models (${current}/${total}):</strong> ${modelName}...`,
                                'info'
                            );
                        }
                    );

                    ttsEngine = result.textToSpeech;
                    cfgs = result.cfgs;

                    executionProvider = 'webgpu';
                    
                } catch (webgpuError) {
                    console.log('WebGPU not available, falling back to WebAssembly');

                    const result = await loadTextToSpeech(
                        basePath,
                        {
                            executionProviders: ['wasm'],
                            graphOptimizationLevel: 'all',
                        },
                        (modelName: string, current: number, total: number) => {
                            showStatus(
                                `ℹ️ <strong>Loading ONNX models (${current}/${total}):</strong> ${modelName}...`,
                                'info'
                            );
                        }
                    );

                    ttsEngine = result.textToSpeech;
                    cfgs = result.cfgs;
                }

                self.postMessage({ type: 'updateConfigInfo', rate: ttsEngine.sampleRate, provider: executionProvider == "webgpu" ? 'WebGPU' : 'WebAssembly' } as WorkerOutMessage);
                sampleRate = ttsEngine.sampleRate;

                showStatus('ℹ️ <strong>Loading default voice style...</strong>', 'info');

                currentStyle = await loadStyleFromJSON(message.currentStylePath);

                showStatus(
                    `✅ <strong>Models loaded!</strong> Using ${executionProvider.toUpperCase()}. You can now generate speech.`,
                    'success'
                );

            } catch (error: any) {
                showStatus(`❌ <strong>Error loading models:</strong> ${error.message}`, 'error');
            }
            break;
        default:
            showStatus(`Unknown message type`, 'error');
            break;

    }


};

function showStatus(text: string, statusType: 'info' | 'success' | 'error' = 'info') {
    const outMessage: WorkerOutMessage = { type: 'showStatus', text, statusType };
    ctx.postMessage(outMessage);
}

function getFilenameFromPath(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
}

async function loadStyleFromJSON(stylePath: string) {
    const style = await loadVoiceStyle([`../${stylePath}`], true);
    return style;
}

async function playChunk(chunk: { wav: any; duration: number; index: number; totalChunks: number;}) {
    self.postMessage({ type: 'streamChunk', chunk });
 };

