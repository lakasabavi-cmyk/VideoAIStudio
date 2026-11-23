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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--language", default="vi",
                        help="'vi', 'en', ... or 'auto' to detect")
    args = parser.parse_args()

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

    # Prefer the GPU (float16 fits a 8 GB card for large-v3); fall
    # back to CPU int8 when CUDA is unavailable or the load fails.
    model = None
    last_error = None
    for device, compute in (("cuda", "float16"), ("cpu", "int8")):
        try:
            stage(f"Loading model {args.model} on {device} "
                  f"(first run downloads the model)")
            model = WhisperModel(args.model, device=device,
                                 compute_type=compute)
            break
        except Exception as exc:  # noqa: BLE001 - report and fall back
            last_error = exc
            stage(f"Model load on {device} failed, trying fallback")
    if model is None:
        print(f"ERROR could not load model {args.model}: {last_error}",
              file=sys.stderr, flush=True)
        return 1

    language = None if args.language == "auto" else args.language

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
        # The VAD is tuned for speech and filters out singing over
        # music entirely — retry without it before giving up.
        stage("No speech found with VAD — retrying without VAD "
              "(singing over music needs this)")
        segments, info, duration = run(use_vad=False)
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
