//! macOS system audio: ScreenCaptureKit (macOS 13+).
//!
//! ScreenCaptureKit's audio capture rides on the Screen Recording grant the
//! share already asks for, so there is no second permission. With
//! `excludesCurrentProcessAudio` the capture leaves Aulora's own playback out,
//! which is what keeps remote voices from echoing back into the call.
//!
//! The stream needs a content filter even for audio, so the filter is the main
//! display with no windows excluded: the audio of a display filter is the
//! system mix. macOS 12.3–12.x expose no audio output type at all, so the
//! backend reports unsupported before 13 and the share stays video-only.

use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
use objc2_core_audio_types::AudioBufferList;
use objc2_core_media::CMSampleBuffer;
use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol};
use objc2_screen_capture_kit::{
    SCContentFilter, SCShareableContent, SCStream, SCStreamConfiguration, SCStreamOutput,
    SCStreamOutputType,
};

use super::{
    interleave, BackendStream, ChunkSink, ChunkWriter, SystemAudioSupport, PREFERRED_CHANNELS,
    PREFERRED_SAMPLE_RATE,
};

/// How long capture setup may take before the share continues without audio.
const SETUP_TIMEOUT: Duration = Duration::from_secs(4);

pub(crate) fn support() -> SystemAudioSupport {
    if !macos_thirteen_or_newer() {
        return SystemAudioSupport {
            supported: false,
            backend: "screencapturekit",
            detail: Some(String::from(
                "macOS 13 or newer is needed to capture system audio; this Mac shares video only.",
            )),
        };
    }
    SystemAudioSupport {
        supported: true,
        backend: "screencapturekit",
        detail: Some(String::from(
            "Captures system audio without Aulora's own playback, using the same Screen Recording \
             permission as the screen share.",
        )),
    }
}

pub(crate) fn start(sink: ChunkSink, _source_hint: Option<&str>) -> Result<BackendStream, String> {
    if !macos_thirteen_or_newer() {
        return Err(String::from(
            "System audio capture needs macOS 13 or newer.",
        ));
    }

    let stopped = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let writer = Arc::new(Mutex::new(Some(ChunkWriter::new(
        PREFERRED_SAMPLE_RATE,
        PREFERRED_CHANNELS,
        sink,
    ))));

    let thread_writer = Arc::clone(&writer);
    let thread_flag = Arc::clone(&stopped);
    let handle = std::thread::Builder::new()
        .name(String::from("aulora-system-audio"))
        .spawn(move || run_capture(thread_writer, thread_flag, ready_tx))
        .map_err(|error| format!("Could not start the system audio thread: {error}"))?;

    match ready_rx.recv_timeout(SETUP_TIMEOUT) {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            stopped.store(true, Ordering::Relaxed);
            let _ = handle.join();
            return Err(error);
        }
        Err(_) => {
            stopped.store(true, Ordering::Relaxed);
            let _ = handle.join();
            return Err(String::from(
                "macOS did not start the audio capture in time; the share continues without system \
                 audio.",
            ));
        }
    }

    Ok(BackendStream {
        sample_rate: PREFERRED_SAMPLE_RATE,
        channels: PREFERRED_CHANNELS,
        backend: "screencapturekit",
        warnings: Vec::new(),
        stop: Box::new(move || {
            stopped.store(true, Ordering::Relaxed);
            let _ = handle.join();
            if let Ok(mut slot) = writer.lock() {
                slot.take();
            }
        }),
    })
}

fn macos_thirteen_or_newer() -> bool {
    objc2::available!(macos = 13.0)
}

/// Owns one SCStream for the life of the capture and clears the writer on exit.
fn run_capture(
    writer: Arc<Mutex<Option<ChunkWriter>>>,
    stopped: Arc<AtomicBool>,
    ready: mpsc::Sender<Result<(), String>>,
) {
    let (stream, _output) = match open_stream(writer) {
        Ok(opened) => opened,
        Err(error) => {
            let _ = ready.send(Err(error));
            return;
        }
    };
    let _ = ready.send(Ok(()));

    while !stopped.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(50));
    }

    let (tx, rx) = mpsc::channel::<()>();
    let done = RcBlock::new(move |_error: *mut NSError| {
        let _ = tx.send(());
    });
    unsafe {
        stream.stopCaptureWithCompletionHandler(Some(&done));
    }
    // A stopped stream delivers no more buffers; a bound keeps a wedged
    // ScreenCaptureKit from blocking the join.
    let _ = rx.recv_timeout(Duration::from_millis(500));
}

/// Builds the filter, configuration and stream, and starts audio delivery.
fn open_stream(
    writer: Arc<Mutex<Option<ChunkWriter>>>,
) -> Result<(Retained<SCStream>, Retained<AudioOutput>), String> {
    let display = main_display()?;

    let empty = NSArray::new();
    let filter = unsafe {
        SCContentFilter::initWithDisplay_excludingWindows(
            SCContentFilter::alloc(),
            &display,
            &empty,
        )
    };

    let configuration = unsafe { SCStreamConfiguration::new() };
    unsafe {
        configuration.setCapturesAudio(true);
        // The whole point: never feed the call's own playback back in.
        configuration.setExcludesCurrentProcessAudio(true);
        configuration.setSampleRate(PREFERRED_SAMPLE_RATE as isize);
        configuration.setChannelCount(PREFERRED_CHANNELS as isize);
        // Audio only: a tiny video surface keeps ScreenCaptureKit from encoding
        // a screen we already capture frame by frame.
        configuration.setWidth(2);
        configuration.setHeight(2);
    }

    let stream = unsafe {
        SCStream::initWithFilter_configuration_delegate(
            SCStream::alloc(),
            &filter,
            &configuration,
            None,
        )
    };

    let output = AudioOutput::new(writer);
    let queue = DispatchQueue::new("dev.spwnd.aulora.system-audio", None);
    unsafe {
        stream
            .addStreamOutput_type_sampleHandlerQueue_error(
                ProtocolObject::from_ref(&*output),
                SCStreamOutputType::Audio,
                Some(&queue),
            )
            .map_err(|error| format!("Could not attach the audio output: {:?}", error))?;
    }

    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let started = RcBlock::new(move |error: *mut NSError| {
        let message = if error.is_null() {
            Ok(())
        } else {
            let description = unsafe { (*error).localizedDescription() };
            Err(format!(
                "ScreenCaptureKit refused the audio stream: {description}"
            ))
        };
        let _ = tx.send(message);
    });
    unsafe {
        stream.startCaptureWithCompletionHandler(Some(&started));
    }
    match rx.recv_timeout(SETUP_TIMEOUT) {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return Err(error),
        Err(_) => return Err(String::from("ScreenCaptureKit did not answer in time.")),
    }

    // Nothing retains the output for us, so the caller holds it for as long as
    // the stream runs.
    Ok((stream, output))
}

/// The display whose mix we capture. Audio is the system's, not the display's,
/// so any attached display works; the main one is the honest default.
fn main_display() -> Result<Retained<objc2_screen_capture_kit::SCDisplay>, String> {
    let (tx, rx) = mpsc::channel::<Result<Retained<objc2_screen_capture_kit::SCDisplay>, String>>();
    let handler = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            let result = if content.is_null() {
                let message = if error.is_null() {
                    String::from("ScreenCaptureKit returned no shareable content.")
                } else {
                    unsafe { (*error).localizedDescription() }.to_string()
                };
                Err(message)
            } else {
                let content = unsafe { Retained::retain(content) };
                match content {
                    Some(content) => {
                        let displays = unsafe { content.displays() };
                        match displays.firstObject() {
                            Some(display) => Ok(display),
                            None => Err(String::from("This Mac reports no display to capture.")),
                        }
                    }
                    None => Err(String::from("Could not read the shareable content.")),
                }
            };
            let _ = tx.send(result);
        },
    );
    unsafe {
        SCShareableContent::getShareableContentWithCompletionHandler(&handler);
    }
    match rx.recv_timeout(SETUP_TIMEOUT) {
        Ok(result) => result,
        Err(_) => Err(String::from(
            "ScreenCaptureKit did not list the displays in time; check the Screen Recording \
             permission.",
        )),
    }
}

/// Receives ScreenCaptureKit's audio buffers and hands them to the writer.
///
/// Ivars may not use `Drop`, so the writer is held in an `Option` inside an
/// `Arc<Mutex<_>>`; the capture thread takes it out when the stream stops.
pub(crate) struct AudioOutputIvars {
    writer: Arc<Mutex<Option<ChunkWriter>>>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "AuloraAudioOutput"]
    #[ivars = AudioOutputIvars]
    pub(crate) struct AudioOutput;

    unsafe impl NSObjectProtocol for AudioOutput {}

    unsafe impl SCStreamOutput for AudioOutput {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        fn stream_didOutputSampleBuffer_ofType(
            &self,
            _stream: &SCStream,
            sample_buffer: &CMSampleBuffer,
            of_type: SCStreamOutputType,
        ) {
            if of_type != SCStreamOutputType::Audio {
                return;
            }
            let Some(samples) = pcm_from_sample_buffer(sample_buffer) else {
                return;
            };
            let Ok(mut slot) = self.ivars().writer.lock() else {
                return;
            };
            if let Some(writer) = slot.as_mut() {
                writer.write(&samples);
            }
        }
    }
);

impl AudioOutput {
    fn new(writer: Arc<Mutex<Option<ChunkWriter>>>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(AudioOutputIvars { writer });
        unsafe { msg_send![super(this), init] }
    }
}

/// Flattens a screen-capture audio buffer into interleaved f32 samples.
fn pcm_from_sample_buffer(sample_buffer: &CMSampleBuffer) -> Option<Vec<f32>> {
    let mut needed: usize = 0;
    let first = unsafe {
        sample_buffer.audio_buffer_list_with_retained_block_buffer(
            &mut needed,
            ptr::null_mut(),
            0,
            None,
            None,
            0,
            ptr::null_mut(),
        )
    };
    if first != 0 || needed == 0 {
        return None;
    }
    // The list is variable length: ask for the required size, then fill it.
    let mut storage = vec![0_u8; needed];
    let list = storage.as_mut_ptr().cast::<AudioBufferList>();
    let status = unsafe {
        sample_buffer.audio_buffer_list_with_retained_block_buffer(
            &mut needed,
            list,
            needed,
            None,
            None,
            0,
            ptr::null_mut(),
        )
    };
    if status != 0 {
        return None;
    }

    let count = unsafe { (*list).mNumberBuffers as usize };
    let base =
        unsafe { ptr::addr_of!((*list).mBuffers).cast::<objc2_core_audio_types::AudioBuffer>() };
    let buffers = unsafe { std::slice::from_raw_parts(base, count) };
    if buffers.is_empty() {
        return None;
    }
    if buffers.len() == 1 && buffers[0].mNumberChannels == u32::from(PREFERRED_CHANNELS) {
        // Already interleaved: copy straight out.
        let count = buffers[0].mDataByteSize as usize / 4;
        let data = unsafe { std::slice::from_raw_parts(buffers[0].mData.cast::<f32>(), count) };
        return Some(data.to_vec());
    }

    let mut planar: Vec<&[f32]> = Vec::with_capacity(buffers.len());
    for buffer in buffers {
        let count = buffer.mDataByteSize as usize / 4;
        planar.push(unsafe { std::slice::from_raw_parts(buffer.mData.cast::<f32>(), count) });
    }
    let mut interleaved = Vec::new();
    interleave(&planar, &mut interleaved);
    Some(interleaved)
}
