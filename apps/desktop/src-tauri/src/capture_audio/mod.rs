//! System-audio capture for the desktop screen share.
//!
//! The webview cannot read the mixed output of the machine on its own (the
//! browser path gets it from `getDisplayMedia`), so the shell captures it here
//! and streams interleaved f32 PCM to the web client, which plays it into a
//! canvas-style audio track. The wire format is fixed:
//!
//! * one [`AudioStreamHeader`] as the command's return value (rate, channels,
//!   backend, warnings),
//! * then raw little-endian f32 chunks of [`CHUNK_MILLIS`] ms each.
//!
//! Backends, one per platform and each gated by `cfg`:
//!
//! * Windows: WASAPI process loopback in exclude mode (Windows 10 2004+), so
//!   the call's own playback is not captured and remote participants do not
//!   hear themselves; older Windows falls back to default-endpoint loopback
//!   with a warning that it will echo.
//! * macOS: ScreenCaptureKit audio (macOS 13+), which rides on the Screen
//!   Recording grant the share already asks for, with
//!   `excludesCurrentProcessAudio`.
//! * Linux: the default sink's monitor source through PulseAudio/PipeWire.
//!   Excluding one process is not generally possible there, so the capture also
//!   contains the call's own playback and the header warns about it.
//!
//! A backend failure is never fatal: the caller degrades to a video-only share
//! and shows the reason.

use std::sync::{Arc, Mutex};

use serde::Serialize;

#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform;

#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod platform;

#[cfg(all(unix, not(target_os = "macos"), not(target_os = "android")))]
#[path = "linux.rs"]
mod platform;

#[cfg(not(any(
    target_os = "windows",
    target_os = "macos",
    all(unix, not(target_os = "android"))
)))]
mod platform {
    use super::{BackendStream, ChunkSink, SystemAudioSupport};

    pub(crate) fn support() -> SystemAudioSupport {
        SystemAudioSupport {
            supported: false,
            backend: "none",
            detail: Some(String::from(
                "Aulora has no system audio capture backend for this platform.",
            )),
        }
    }

    pub(crate) fn start(
        _sink: ChunkSink,
        _source_hint: Option<&str>,
    ) -> Result<BackendStream, String> {
        Err(String::from(
            "System audio capture is not available on this platform.",
        ))
    }
}

/// Length of one PCM chunk. 20 ms keeps the added latency small without
/// flooding the IPC bridge with tiny messages.
pub const CHUNK_MILLIS: u32 = 20;

/// What every backend converts to before handing samples over.
pub const PREFERRED_SAMPLE_RATE: u32 = 48_000;
pub const PREFERRED_CHANNELS: u16 = 2;

/// Interleaved f32 little-endian, which the web client plays straight into a
/// worklet with no decoding step.
pub const WIRE_FORMAT: &str = "f32";

/// What the shell reports before the first chunk arrives.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStreamHeader {
    pub sample_rate: u32,
    pub channels: u16,
    pub format: &'static str,
    /// Which backend produced the samples.
    pub backend: &'static str,
    /// Non-fatal caveats, e.g. that the capture includes the call's own audio.
    pub warnings: Vec<String>,
}

/// Whether this platform can capture system audio, for the share picker.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAudioSupport {
    pub supported: bool,
    pub backend: &'static str,
    /// Why it is unavailable, or what to expect from it (echo, permissions).
    pub detail: Option<String>,
}

/// Receives one chunk of interleaved f32 samples; `false` stops the backend
/// (the webview is gone, or the person stopped sharing).
pub(crate) type ChunkSink = Arc<dyn Fn(&[f32]) -> bool + Send + Sync>;

/// A started backend plus everything the caller needs to describe and stop it.
pub(crate) struct BackendStream {
    pub sample_rate: u32,
    pub channels: u16,
    pub backend: &'static str,
    pub warnings: Vec<String>,
    /// Stops the capture and releases the device. Runs at most once.
    pub stop: Box<dyn FnOnce() + Send>,
}

/// Whether this platform has a backend at all, and what to warn about.
pub fn system_audio_support() -> SystemAudioSupport {
    platform::support()
}

/// One running capture, if any. The command layer owns this in Tauri state so a
/// new share replaces the previous stream instead of capturing twice.
#[derive(Default)]
pub struct AudioCaptureState {
    session: Mutex<Option<BackendStream>>,
}

impl AudioCaptureState {
    /// Starts a capture, replacing (and stopping) any previous one.
    ///
    /// `emit` receives each chunk of interleaved f32; it must be cheap and
    /// thread-safe, because a backend thread calls it.
    pub fn start<F>(&self, emit: F, source_hint: Option<&str>) -> Result<AudioStreamHeader, String>
    where
        F: Fn(&[f32]) -> bool + Send + Sync + 'static,
    {
        self.stop();
        let mut stream = platform::start(Arc::new(emit), source_hint)?;
        let header = AudioStreamHeader {
            sample_rate: stream.sample_rate,
            channels: stream.channels,
            format: WIRE_FORMAT,
            backend: stream.backend,
            warnings: std::mem::take(&mut stream.warnings),
        };
        *lock(&self.session) = Some(stream);
        Ok(header)
    }

    /// Stops the capture. Safe to call when nothing is running, and more than
    /// once.
    pub fn stop(&self) {
        let session = lock(&self.session).take();
        if let Some(stream) = session {
            (stream.stop)();
        }
    }
}

/// A poisoned lock would only mean a backend thread panicked while starting;
/// the state itself is still a plain `Option`, so recovering is correct.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

/// Groups device-sized reads into fixed chunks, so the web client sees a steady
/// cadence instead of whatever block size the OS picked.
pub(crate) struct Chunker {
    frames_per_chunk: usize,
    channels: usize,
    pending: Vec<f32>,
}

impl Chunker {
    pub(crate) fn new(sample_rate: u32, channels: u16) -> Self {
        let channels = usize::from(channels.max(1));
        let frames = (sample_rate as u64 * u64::from(CHUNK_MILLIS) / 1000) as usize;
        Self {
            frames_per_chunk: frames.max(1),
            channels,
            pending: Vec::with_capacity(frames.max(1) * channels * 2),
        }
    }

    /// Appends samples and emits every complete chunk.
    pub(crate) fn push(&mut self, samples: &[f32], emit: &mut dyn FnMut(&[f32])) {
        if samples.is_empty() {
            return;
        }
        self.pending.extend_from_slice(samples);
        let chunk_len = self.frames_per_chunk * self.channels;
        let mut start = 0;
        while start + chunk_len <= self.pending.len() {
            emit(&self.pending[start..start + chunk_len]);
            start += chunk_len;
        }
        if start > 0 {
            self.pending.drain(..start);
        }
    }

    /// Emits a short remainder so stopping does not clip the tail.
    pub(crate) fn flush(&mut self, emit: &mut dyn FnMut(&[f32])) {
        if !self.pending.is_empty() {
            emit(&self.pending);
            self.pending.clear();
        }
    }
}

/// Chunks what a backend reads and hands it to the sink that ships it to the
/// webview. Shared by every backend so chunking and stop handling stay in one
/// place.
pub(crate) struct ChunkWriter {
    chunker: Chunker,
    sink: ChunkSink,
}

impl ChunkWriter {
    pub(crate) fn new(sample_rate: u32, channels: u16, sink: ChunkSink) -> Self {
        Self {
            chunker: Chunker::new(sample_rate, channels),
            sink,
        }
    }

    /// Feeds interleaved samples; `false` means the sink is gone, stop reading.
    pub(crate) fn write(&mut self, samples: &[f32]) -> bool {
        let sink = Arc::clone(&self.sink);
        let mut alive = true;
        self.chunker.push(samples, &mut |chunk| {
            if alive {
                alive = sink(chunk);
            }
        });
        alive
    }

    /// Emits whatever is left when the stream ends.
    pub(crate) fn finish(&mut self) {
        let sink = Arc::clone(&self.sink);
        self.chunker.flush(&mut |chunk| {
            sink(chunk);
        });
    }
}

/// Converts interleaved 16-bit samples to f32 in `[-1, 1)`.
pub(crate) fn i16_to_f32(input: &[i16], out: &mut Vec<f32>) {
    out.clear();
    out.reserve(input.len());
    for sample in input {
        out.push(f32::from(*sample) / 32_768.0);
    }
}

/// Interleaves planar channels (one slice per channel) into one buffer.
///
/// Backends that hand over planar audio (ScreenCaptureKit does) go through this
/// so everything downstream sees the same layout.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn interleave(planar: &[&[f32]], out: &mut Vec<f32>) {
    out.clear();
    if planar.is_empty() {
        return;
    }
    let frames = planar
        .iter()
        .map(|channel| channel.len())
        .min()
        .unwrap_or(0);
    out.reserve(frames * planar.len());
    for frame in 0..frames {
        for channel in planar {
            out.push(channel[frame]);
        }
    }
}

/// Encodes interleaved f32 as the little-endian bytes the web client receives.
pub(crate) fn encode_f32le(samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 4);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(chunker: &mut Chunker, samples: &[f32]) -> Vec<Vec<f32>> {
        let mut chunks = Vec::new();
        chunker.push(samples, &mut |chunk| chunks.push(chunk.to_vec()));
        chunks
    }

    #[test]
    fn chunks_are_twenty_milliseconds_of_interleaved_samples() {
        let mut chunker = Chunker::new(48_000, 2);
        // 960 frames per chunk at 48 kHz; 640 frames is not enough for one.
        assert!(collect(&mut chunker, &[0.0; 640 * 2]).is_empty());
        let chunks = collect(&mut chunker, &[0.0; 320 * 2]);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].len(), 960 * 2);
    }

    #[test]
    fn chunker_carries_a_partial_chunk_between_reads() {
        let mut chunker = Chunker::new(1_000, 1);
        // 1000 frames/s → 20 frames per chunk.
        let chunks = collect(&mut chunker, &[1.0; 15]);
        assert!(chunks.is_empty());
        let chunks = collect(&mut chunker, &[2.0; 10]);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].len(), 20);
        assert_eq!(chunks[0][0], 1.0);
        assert_eq!(chunks[0][19], 2.0);
        // The five leftover samples stay queued.
        let mut tail = Vec::new();
        chunker.flush(&mut |chunk| tail.push(chunk.to_vec()));
        assert_eq!(tail, vec![vec![2.0; 5]]);
    }

    #[test]
    fn chunk_writer_forwards_full_chunks() {
        let chunks = Arc::new(Mutex::new(Vec::<usize>::new()));
        let seen = Arc::clone(&chunks);
        let mut writer = ChunkWriter::new(
            1_000,
            1,
            Arc::new(move |chunk: &[f32]| {
                seen.lock().expect("lock").push(chunk.len());
                true
            }),
        );
        // 1000 frames/s → two 20-frame chunks from 40 samples.
        assert!(writer.write(&[0.0; 40]));
        assert_eq!(*chunks.lock().expect("lock"), vec![20, 20]);
    }

    #[test]
    fn chunk_writer_stops_when_the_sink_is_gone() {
        let calls = Arc::new(Mutex::new(0_usize));
        let seen = Arc::clone(&calls);
        let mut writer = ChunkWriter::new(
            1_000,
            1,
            Arc::new(move |_chunk: &[f32]| {
                *seen.lock().expect("lock") += 1;
                false
            }),
        );
        assert!(!writer.write(&[0.0; 40]));
        // The closed sink is not called again for the rest of the read.
        assert_eq!(*calls.lock().expect("lock"), 1);
    }

    #[test]
    fn flush_on_an_empty_chunker_emits_nothing() {
        let mut chunker = Chunker::new(48_000, 2);
        let mut calls = 0;
        chunker.flush(&mut |_| calls += 1);
        assert_eq!(calls, 0);
    }

    #[test]
    fn i16_conversion_maps_full_scale() {
        let mut out = Vec::new();
        i16_to_f32(&[0, 16_384, -32_768, 32_767], &mut out);
        assert_eq!(out[0], 0.0);
        assert_eq!(out[1], 0.5);
        assert_eq!(out[2], -1.0);
        assert!((out[3] - 0.999_969_5).abs() < 1e-6);
    }

    #[test]
    fn interleave_walks_channels_frame_by_frame() {
        let left = [1.0, 2.0, 3.0];
        let right = [10.0, 20.0, 30.0];
        let mut out = Vec::new();
        interleave(&[&left, &right], &mut out);
        assert_eq!(out, vec![1.0, 10.0, 2.0, 20.0, 3.0, 30.0]);
    }

    #[test]
    fn interleave_uses_the_shortest_channel() {
        let full = [1.0, 2.0];
        let short = [9.0];
        let mut out = Vec::new();
        interleave(&[&full, &short], &mut out);
        assert_eq!(out, vec![1.0, 9.0]);
    }

    #[test]
    fn encode_is_little_endian_f32() {
        assert_eq!(
            encode_f32le(&[1.0, -1.0]),
            vec![0, 0, 128, 63, 0, 0, 128, 191]
        );
        assert!(encode_f32le(&[]).is_empty());
    }
}
