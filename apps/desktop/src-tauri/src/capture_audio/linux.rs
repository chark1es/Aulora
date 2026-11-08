//! Linux system audio: the default sink's monitor source.
//!
//! PulseAudio, and PipeWire's PulseAudio compatibility layer, publishes every
//! sink's mixed output as a `<sink>.monitor` recording source, so recording the
//! default sink's monitor is recording what the machine is playing.
//!
//! PulseAudio has no way to keep one process out of a monitor, so the capture
//! also contains Aulora's own call audio: other participants hear themselves
//! faintly. That is a platform limit, reported in the header and shown in the
//! picker, not something this backend can fix.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use libpulse_binding::context::{Context, FlagSet, State};
use libpulse_binding::mainloop::standard::Mainloop;
use libpulse_binding::sample::{Format, Spec};
use libpulse_binding::stream::Direction;
use libpulse_simple_binding::Simple;

use super::{
    BackendStream, ChunkSink, ChunkWriter, SystemAudioSupport, CHUNK_MILLIS, PREFERRED_CHANNELS,
    PREFERRED_SAMPLE_RATE,
};

/// Longest the lookup may take before the share continues without audio.
const LOOKUP_TIMEOUT: Duration = Duration::from_millis(2_000);
const POLL_INTERVAL: Duration = Duration::from_millis(5);

pub(crate) fn support() -> SystemAudioSupport {
    SystemAudioSupport {
        supported: true,
        backend: "pulse-monitor",
        detail: Some(String::from(
            "Records the default output's monitor source. PulseAudio cannot exclude one process, \
             so the call's own audio is captured too and others may hear themselves faintly.",
        )),
    }
}

pub(crate) fn start(sink: ChunkSink, _source_hint: Option<&str>) -> Result<BackendStream, String> {
    let monitor = default_monitor_source()?;
    let spec = Spec {
        format: Format::F32le,
        rate: PREFERRED_SAMPLE_RATE,
        channels: PREFERRED_CHANNELS as u8,
    };
    let simple = Simple::new(
        None,
        "Aulora",
        Direction::Record,
        Some(&monitor),
        "System audio",
        &spec,
        None,
        None,
    )
    .map_err(|error| format!("Could not record the system audio monitor: {error}"))?;

    let stopped = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stopped);
    let mut writer = ChunkWriter::new(PREFERRED_SAMPLE_RATE, PREFERRED_CHANNELS, sink);
    let frames = (PREFERRED_SAMPLE_RATE as usize * CHUNK_MILLIS as usize) / 1000;
    let handle = std::thread::Builder::new()
        .name(String::from("aulora-system-audio"))
        .spawn(move || {
            let mut bytes = vec![0_u8; frames * usize::from(PREFERRED_CHANNELS) * 4];
            let mut samples = Vec::with_capacity(frames * usize::from(PREFERRED_CHANNELS));
            // 20 ms reads also bound how long `stop` waits for the thread.
            while !flag.load(Ordering::Relaxed) {
                if simple.read(&mut bytes).is_err() {
                    break;
                }
                samples.clear();
                samples.extend(
                    bytes
                        .chunks_exact(4)
                        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
                );
                if !writer.write(&samples) {
                    break;
                }
            }
            writer.finish();
        })
        .map_err(|error| format!("Could not start the system audio thread: {error}"))?;

    Ok(BackendStream {
        sample_rate: PREFERRED_SAMPLE_RATE,
        channels: PREFERRED_CHANNELS,
        backend: "pulse-monitor",
        warnings: vec![String::from(
            "System audio includes Aulora's own call audio on Linux: other participants may hear \
             themselves faintly.",
        )],
        stop: Box::new(move || {
            stopped.store(true, Ordering::Relaxed);
            let _ = handle.join();
        }),
    })
}

/// The recording source name of the default sink, e.g. `alsa_output.pci.analog-
/// stereo.monitor`. Resolved through the context API because the monitor name
/// is not known ahead of time and `@DEFAULT_MONITOR@` is a tool alias libpulse
/// itself does not accept.
fn default_monitor_source() -> Result<String, String> {
    let mut mainloop =
        Mainloop::new().ok_or_else(|| String::from("Could not start the PulseAudio client."))?;
    let mut context = Context::new(&mainloop, "Aulora system audio")
        .ok_or_else(|| String::from("Could not create a PulseAudio context."))?;
    context
        .connect(None, FlagSet::empty(), None)
        .map_err(|error| format!("Could not reach PulseAudio: {error}"))?;

    let deadline = Instant::now() + LOOKUP_TIMEOUT;
    loop {
        match context.get_state() {
            State::Ready => break,
            State::Failed | State::Terminated => {
                context.disconnect();
                return Err(String::from(
                    "PulseAudio is not running, so the system audio cannot be captured.",
                ));
            }
            _ => {
                if Instant::now() > deadline {
                    context.disconnect();
                    return Err(String::from(
                        "PulseAudio did not answer in time; the share continues without system audio.",
                    ));
                }
                // Non-blocking: a bounded poll keeps this path from hanging the
                // share on a wedged sound server.
                let _ = mainloop.iterate(false);
                std::thread::sleep(POLL_INTERVAL);
            }
        }
    }

    let name: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let slot = Arc::clone(&name);
    context.introspect().get_server_info(move |info| {
        *lock(&slot) = info.default_sink_name.as_ref().map(|name| name.to_string());
    });

    let deadline = Instant::now() + LOOKUP_TIMEOUT;
    loop {
        if lock(&name).is_some() {
            break;
        }
        if Instant::now() > deadline {
            break;
        }
        let _ = mainloop.iterate(false);
        std::thread::sleep(POLL_INTERVAL);
    }
    context.disconnect();

    // Bind the value first: the lock guard must not outlive the match.
    let resolved = lock(&name).take();
    match resolved {
        Some(sink) if !sink.is_empty() => Ok(format!("{sink}.monitor")),
        _ => Err(String::from(
            "PulseAudio reports no default output, so there is no system audio to capture.",
        )),
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}
