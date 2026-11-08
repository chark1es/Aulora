//! Windows system audio: WASAPI loopback.
//!
//! Two modes, chosen at runtime:
//!
//! * **Process loopback, exclude mode** (Windows 10 2004+): the capture contains
//!   the default output minus the WebView2 process that plays the call's own
//!   remote voices, so they are never fed back to the call. This replaces the
//!   browser path's `suppressLocalAudioPlayback`. The target is the WebView2
//!   *browser* process, not Aulora's own: Windows only follows a process's
//!   direct children, and the audio is played by a helper that is a child of
//!   the browser process, a grandchild of the app (measured on Windows 11).
//! * **Default-endpoint loopback**: the only loopback older Windows offers. It
//!   cannot exclude a process, so the header carries a warning that the capture
//!   will echo, and the picker shows it.
//!
//! Both are `AUDCLNT_STREAMFLAGS_LOOPBACK` streams with 20 ms event-driven
//! buffers; the samples are converted to interleaved f32 before they leave.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use wasapi::{
    initialize_mta, AudioClient, DeviceEnumerator, Direction, SampleType, StreamMode, WasapiError,
    WaveFormat,
};

use super::{
    i16_to_f32, BackendStream, ChunkSink, ChunkWriter, SystemAudioSupport, CHUNK_MILLIS,
    PREFERRED_CHANNELS, PREFERRED_SAMPLE_RATE,
};

/// The wire is always f32; some endpoints only mix at 16 bits, so the reader
/// converts. `autoconvert` normally makes this unnecessary.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SampleFormat {
    F32,
    I16,
}

/// Event-driven buffer length, in 100 ns units: one chatty chunk.
const BUFFER_HNS: i64 = CHUNK_MILLIS as i64 * 10_000;
/// How long a start may take before the share carries on without audio.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(3);

pub(crate) fn support() -> SystemAudioSupport {
    SystemAudioSupport {
        supported: true,
        backend: "wasapi-loopback",
        detail: Some(String::from(
            "Captures the default output without Aulora's own audio, so other participants do not \
             hear themselves. Needs Windows 10 version 2004 or newer; older builds capture the \
             whole mix.",
        )),
    }
}

/// What the capture thread learned while starting, reported back to the caller.
struct Startup {
    backend: &'static str,
    warnings: Vec<String>,
}

pub(crate) fn start(sink: ChunkSink, _source_hint: Option<&str>) -> Result<BackendStream, String> {
    let stopped = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stopped);
    let (ready_tx, ready_rx) = mpsc::channel::<Result<Startup, String>>();

    let handle = std::thread::Builder::new()
        .name(String::from("aulora-system-audio"))
        .spawn(move || match open_stream() {
            Ok((client, startup, format)) => {
                if ready_tx.send(Ok(startup)).is_err() {
                    return;
                }
                read_loop(client, sink, flag, format);
            }
            Err(error) => {
                let _ = ready_tx.send(Err(error));
            }
        })
        .map_err(|error| format!("Could not start the system audio thread: {error}"))?;

    let startup = match ready_rx.recv_timeout(STARTUP_TIMEOUT) {
        Ok(Ok(startup)) => startup,
        Ok(Err(error)) => {
            let _ = handle.join();
            return Err(error);
        }
        Err(_) => {
            stopped.store(true, Ordering::Relaxed);
            let _ = handle.join();
            return Err(String::from(
                "Windows did not open the audio capture in time; the share continues without \
                 system audio.",
            ));
        }
    };

    Ok(BackendStream {
        sample_rate: PREFERRED_SAMPLE_RATE,
        channels: PREFERRED_CHANNELS,
        backend: startup.backend,
        warnings: startup.warnings,
        stop: Box::new(move || {
            stopped.store(true, Ordering::Relaxed);
            let _ = handle.join();
        }),
    })
}

/// The process whose audio the capture leaves out: the WebView2 browser process
/// (a direct child of this one), which is the parent of the helper that plays
/// the page's sound. Falls back to this process if it cannot be found, which
/// excludes nothing useful but keeps the capture working.
fn excluded_process_id() -> u32 {
    webview_browser_process_id().unwrap_or_else(std::process::id)
}

fn webview_browser_process_id() -> Option<u32> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let own = std::process::id();
    // SAFETY: a plain Toolhelp snapshot walk. `entry` is zeroed with `dwSize`
    // set as the API requires, and the snapshot handle is closed on every path.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = None;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            if entry.th32ParentProcessID == own && is_webview_executable(&entry.szExeFile) {
                found = Some(entry.th32ProcessID);
                break;
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        found
    }
}

/// Whether a NUL-terminated UTF-16 executable name is the WebView2 runtime.
fn is_webview_executable(name: &[u16]) -> bool {
    let len = name
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(name.len());
    String::from_utf16_lossy(&name[..len]).eq_ignore_ascii_case("msedgewebview2.exe")
}

/// Opens a loopback client and starts it, preferring the mode that leaves
/// Aulora's own audio out.
fn open_stream() -> Result<(AudioClient, Startup, SampleFormat), String> {
    initialize_mta()
        .ok()
        .map_err(|error| format!("Could not initialise COM for audio capture: {error}"))?;

    let format = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        PREFERRED_SAMPLE_RATE as usize,
        PREFERRED_CHANNELS as usize,
        None,
    );

    let (mut client, startup, sample_format) = match AudioClient::new_application_loopback_client(
        excluded_process_id(),
        // Exclude mode: everything but that process and its children.
        false,
    ) {
        Ok(client) => (
            client,
            Startup {
                backend: "wasapi-exclude-process",
                warnings: Vec::new(),
            },
            SampleFormat::F32,
        ),
        Err(_) => {
            let enumerator = DeviceEnumerator::new()
                .map_err(|error| format!("Could not list the audio devices: {error}"))?;
            let device = enumerator
                .get_default_device(&Direction::Render)
                .map_err(|error| format!("No default output device to capture: {error}"))?;
            let client = device
                .get_iaudioclient()
                .map_err(|error| format!("Could not open the default output: {error}"))?;
            (
                client,
                Startup {
                    backend: "wasapi-endpoint-loopback",
                    warnings: vec![String::from(
                        "This Windows version cannot keep Aulora's own audio out of the capture, so \
                         other participants may hear themselves.",
                    )],
                },
                SampleFormat::F32,
            )
        }
    };

    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: BUFFER_HNS,
    };
    // A render endpoint opened as capture is the loopback stream.
    if client
        .initialize_client(&format, &Direction::Capture, &mode)
        .is_ok()
    {
        return Ok((client, startup, sample_format));
    }

    // Fall back to 16-bit: some loopback endpoints refuse float mixing even
    // with conversion on. The reader converts to f32 either way.
    let sixteen = WaveFormat::new(
        16,
        16,
        &SampleType::Int,
        PREFERRED_SAMPLE_RATE as usize,
        PREFERRED_CHANNELS as usize,
        None,
    );
    client
        .initialize_client(&sixteen, &Direction::Capture, &mode)
        .map_err(|error| format!("Could not start the audio capture stream: {error}"))?;
    Ok((client, startup, SampleFormat::I16))
}

/// Reads packets until stopped, with one 20 ms timeout so `stop` is responsive.
fn read_loop(client: AudioClient, sink: ChunkSink, stopped: Arc<AtomicBool>, format: SampleFormat) {
    let mut writer = ChunkWriter::new(PREFERRED_SAMPLE_RATE, PREFERRED_CHANNELS, sink);
    let Ok(event) = client.set_get_eventhandle() else {
        return;
    };
    let Ok(capture) = client.get_audiocaptureclient() else {
        return;
    };
    if client.start_stream().is_err() {
        return;
    }

    let channels = usize::from(PREFERRED_CHANNELS);
    let sample_bytes = match format {
        SampleFormat::F32 => 4,
        SampleFormat::I16 => 2,
    };
    let bytes_per_frame = channels * sample_bytes;
    let mut bytes: Vec<u8> = Vec::new();
    let mut samples: Vec<f32> = Vec::new();

    while !stopped.load(Ordering::Relaxed) {
        match event.wait_for_event(CHUNK_MILLIS) {
            Ok(()) => {}
            Err(WasapiError::EventTimeout) => continue,
            Err(_) => break,
        }
        loop {
            let frames = match capture.get_next_packet_size() {
                Ok(Some(frames)) if frames > 0 => frames as usize,
                _ => break,
            };
            let needed = frames * bytes_per_frame;
            if bytes.len() < needed {
                bytes.resize(needed, 0);
            }
            let read = match capture.read_from_device(&mut bytes[..needed]) {
                Ok((read, info)) => (read as usize, info),
                Err(_) => break,
            };
            let (frame_count, info) = read;
            samples.clear();
            if info.flags.silent {
                samples.resize(frame_count * channels, 0.0);
            } else {
                let len = frame_count * bytes_per_frame;
                match format {
                    SampleFormat::F32 => samples.extend(
                        bytes[..len]
                            .chunks_exact(4)
                            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
                    ),
                    SampleFormat::I16 => {
                        let mut decoded = Vec::with_capacity(len / 2);
                        decoded.extend(
                            bytes[..len]
                                .chunks_exact(2)
                                .map(|b| i16::from_le_bytes([b[0], b[1]])),
                        );
                        i16_to_f32(&decoded, &mut samples);
                    }
                }
            }
            if !writer.write(&samples) {
                let _ = client.stop_stream();
                return;
            }
        }
    }

    let _ = client.stop_stream();
    writer.finish();
}

#[cfg(test)]
mod tests {
    use super::is_webview_executable;

    fn wide(text: &str) -> Vec<u16> {
        let mut units: Vec<u16> = text.encode_utf16().collect();
        units.resize(260, 0);
        units
    }

    #[test]
    fn recognises_the_webview2_runtime_by_name() {
        assert!(is_webview_executable(&wide("msedgewebview2.exe")));
        assert!(is_webview_executable(&wide("MSEdgeWebView2.EXE")));
    }

    #[test]
    fn ignores_other_executables() {
        assert!(!is_webview_executable(&wide("aulora-desktop.exe")));
        assert!(!is_webview_executable(&wide("msedge.exe")));
        assert!(!is_webview_executable(&wide("")));
    }
}
