#!/usr/bin/env python3
"""faster-whisper sidecar for VideoAI Studio's Transcript Editor.

Usage:
    python transcribe.py --input <media> --output <transcript.json>
        --model large-v3 --language vi

Prints machine-readable lines on stdout for the app:
    STAGE <text>        pipeline stage (model load, transcribing, ...)
    PROGRESS <0-100>    percent of media duration transcribed
    DONE <output path>  finished, JSON written
Errors go to stderr and the exit code is non-zero.

The output JSON matches the TranscriptData type in the app:
    { "version": 1, "mediaPath": ..., "language": ..., "duration": ...,
      "model": ..., "segments": [ { "start": ..., "end": ...,
      "words": [ { "start": ..., "end": ..., "word": ...,
                   "probability": ... } ] } ] }
Word strings are stored trimmed; display spacing is the app's job.
"""

import argparse
import json
import os
import sys


def stage(text):
    print(f"STAGE {text}", flush=True)


def progress(pct):
    print(f"PROGRESS {max(0, min(100, int(pct)))}", flush=True)


def register_cuda_dll_dirs():
    """Make the pip-installed CUDA runtime libraries findable.

    On Windows, ctranslate2 needs cublas64_12.dll and the cuDNN
    DLLs at transcription time. They ship as the pip packages
    nvidia-cublas-cu12 and nvidia-cudnn-cu12 (setup-whisper.bat
    installs them), but their bin folders are not on the DLL
    search path, so register every nvidia/*/bin folder under
    site-packages explicitly.
    """
    if os.name != "nt":
        return
    try:
        import site
        roots = list(site.getsitepackages())
    except Exception:  # noqa: BLE001 - best effort only
        roots = []
    exe_dir = os.path.dirname(sys.executable)
    roots.append(os.path.join(exe_dir, "Lib", "site-packages"))
    for root in roots:
        nvidia_dir = os.path.join(root, "nvidia")
        if not os.path.isdir(nvidia_dir):
            continue
        for entry in sorted(os.listdir(nvidia_dir)):
            bin_dir = os.path.join(nvidia_dir, entry, "bin")
            if os.path.isdir(bin_dir):
                try:
                    os.add_dll_directory(bin_dir)
                except OSError:
                    pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--language", default="vi",
                        help="'vi', 'en', ... or 'auto' to detect")
    args = parser.parse_args()

    register_cuda_dll_dirs()
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("ERROR faster-whisper is not installed in this Python "
              "environment. Run tools/setup-whisper.bat once, then point "
              "Settings at the python.exe it creates.",
              file=sys.stderr, flush=True)
        return 2

    if not os.path.isfile(args.input):
        print(f"ERROR input file not found: {args.input}",
              file=sys.stderr, flush=True)
        return 2

    language = None if args.language == "auto" else args.language

    def attempt(device, compute):
        stage(f"Loading model {args.model} on {device} "
              f"(first run downloads the model)")
        model = WhisperModel(args.model, device=device,
                             compute_type=compute)

        def run(use_vad):
            segments_iter, info = model.transcribe(
                args.input,
                language=language,
                word_timestamps=True,
                vad_filter=use_vad,
                vad_parameters={"min_silence_duration_ms": 500} if use_vad else None,
            )
            duration = float(info.duration or 0)
            collected = []
            for seg in segments_iter:
                words = []
                for w in seg.words or []:
                    text = (w.word or "").strip()
                    if not text:
                        continue
                    words.append({
                        "start": round(float(w.start), 3),
                        "end": round(float(w.end), 3),
                        "word": text,
                        "probability": round(float(w.probability), 3),
                    })
                if words:
                    collected.append({
                        "start": round(float(seg.start), 3),
                        "end": round(float(seg.end), 3),
                        "words": words,
                    })
                if duration > 0:
                    progress(seg.end / duration * 100)
            return collected, info, duration

        stage("Transcribing")
        segments, info, duration = run(use_vad=True)
        if not segments:
            # The VAD is tuned for speech and filters out singing
            # over music entirely — retry without it before
            # giving up.
            stage("No speech found with VAD — retrying without VAD "
                  "(singing over music needs this)")
            segments, info, duration = run(use_vad=False)
        return segments, info, duration

    # Prefer the GPU (float16 fits an 8 GB card for large-v3); fall
    # back to CPU int8. The fallback wraps the WHOLE attempt, not
    # just the model load: ctranslate2 loads its CUDA libraries
    # lazily, so a missing cublas64_12.dll only surfaces
    # mid-transcription — code that only guards the load dies on
    # exactly that, which is what happened on Hung's machine.
    segments = None
    info = None
    duration = 0.0
    last_error = None
    for device, compute in (("cuda", "float16"), ("cpu", "int8")):
        try:
            segments, info, duration = attempt(device, compute)
            break
        except Exception as exc:  # noqa: BLE001 - report and fall back
            last_error = exc
            segments = None
            if device == "cuda":
                stage(f"GPU transcription failed, retrying on CPU ({exc})")
            else:
                stage(f"CPU transcription failed ({exc})")
    if segments is None:
        print(f"ERROR transcription failed: {last_error}",
              file=sys.stderr, flush=True)
        return 1
    stage(f"Transcribed (language: {info.language}, "
          f"duration: {duration:.1f}s, segments: {len(segments)})")

    data = {
        "version": 1,
        "mediaPath": args.input,
        "language": info.language,
        "duration": duration,
        "model": args.model,
        "segments": segments,
    }

    # Write atomically: a half-written sidecar must never be loaded.
    tmp_path = args.output + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    os.replace(tmp_path, args.output)

    progress(100)
    print(f"DONE {args.output}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
