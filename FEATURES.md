# Confirmed features

The mechanism of each feature, as confirmed by the user. When a
feature changes, update this file in the same commit — later work
checks the mechanism against this list instead of rebuilding it
from memory.

## Import & preview

- Import videos via file dialog or drag-and-drop; metadata
  (duration, resolution, fps, codecs) is read with ffprobe.
- Preview plays through a custom `media://` protocol with HTTP
  Range support (plain `file://` is blocked from the dev origin).

## Remove Silence

- Detects silent spans and cuts BOTH picture and sound so the
  result stays in sync; small padding kept around speech.

## Original Volume (confirmed 2026-11-23)

- A slider in Settings, 0–100%, persisted. It scales the video's
  ORIGINAL audio track: 0% is a full mute, 100% is unchanged.
- "Adjust Volume" applies it and writes `<name>.vol.mp4` (video
  stream copied, audio re-encoded).
- The same setting is applied to the original track when adding
  music, so the original can be muted under new music.
- This replaced an earlier "voice focus / remove music" build
  (dialogue enhancement), which was NOT what the user meant and
  is removed. Do not rebuild that mechanism.

## Add Music

- Mixes a chosen music file under/over the original track
  (original level = the Original Volume setting; music loops to
  cover the video; mix does not auto-lower the voice).

## Get Last Frame (added 2026-11-23)

- Extracts the video's TRUE last frame (decodes the tail and
  keeps the final image — seeking near the end is not
  frame-accurate enough) and saves it as
  `<video folder>/first frame/<name>_lastframe.png`, creating
  the folder if needed. The PNG is meant to be used as the
  first frame of the next generated scene.

## Merge Videos (added 2026-11-23)

- Merges all imported videos in list order into
  `<first name>.merged.mp4`, normalised to the first clip's
  size and frame rate.
- Because each scene is generated from the previous scene's
  last frame, that frame exists twice (end of clip N, start of
  clip N+1). The merge DROPS THE FIRST FRAME of every clip
  after the first, and trims its audio by the same one-frame
  duration, so the joined video has no duplicated seam frames.
- Frame-exactness is verified: each segment's audio is locked
  to exactly its video length inside the filter graph,
  otherwise the concat filter invents duplicate frames at the
  joins.

## Upscale (added 2026-11-23)

Two methods, chosen in Settings; the Dashboard Upscale button
runs a job with the saved options. Output names:
`name_1080p.mp4` / `name_2k.mp4` / `name_4k.mp4` / `name_8k.mp4`
for Lanczos, `name_2x.mp4` / `name_4x.mp4` for Real-ESRGAN.

- **Lanczos (quick)**: one ffmpeg pass, `scale` filter with
  Lanczos to the target height (1080 / 1440 / 2160 / 4320),
  aspect ratio kept, audio copied.
- **Real-ESRGAN**: uses the realesrgan-ncnn-vulkan EXECUTABLE
  (path set in Settings), never the ffmpeg scaler. Pipeline:
  Extract Frames (PNG sequence) → Upscale (ncnn-vulkan;
  2x/3x = realesr-animevideov3, 4x = realesrgan-x4plus) →
  Rebuild Video (ffmpeg at the original fps, original audio
  re-attached by stream copy). The Render Queue shows the
  current stage and overall progress across the stages.
- **RIFE (optional, integrated into the Real-ESRGAN pipeline)**:
  rife-ncnn-vulkan executable (path in Settings, model folder
  default `rife-v4.6` next to it). When enabled it runs at the
  ORIGINAL resolution between Extract Frames and Upscale —
  interpolating first is far cheaper than interpolating
  upscaled frames, and the upscaler then treats every final
  frame the same. Multiplier 2x or 4x frame rate (24 fps →
  48 fps at 2x); output name gains a `_rife2x` / `_rife4x`
  suffix. Queue stages: Extract Frames → RIFE Interpolation →
  Upscale → Rebuild Video.
- Both ncnn tools need a Vulkan GPU on the user's machine; if
  the executable or model is missing the job fails immediately
  with a message saying what to set in Settings.

## Render Queue job timing (added 2026-11-23)

- Every job records when it started and finished. The Render
  Queue shows a time line under each job: queued clock time for
  pending jobs; "Started HH:MM:SS · Elapsed MM:SS · ETA ~MM:SS"
  (ticking every second, ETA from progress) while processing;
  "Took MM:SS · Finished HH:MM:SS" when done.

## System Monitor (added 2026-11-23)

- A live panel at the bottom of the Settings page, refreshed
  every 2 seconds while the page is open: CPU load, RAM
  used/total, GPU utilisation, VRAM used/total and GPU
  temperature (via nvidia-smi; needs the NVIDIA driver). CPU
  temperature is shown when Windows exposes it via WMI,
  otherwise "n/a". Bars turn amber at 70% and red at 90%
  (or when the GPU reaches 85°C).

## Export

- Re-encodes with explicit codecs (libx264 / yuv420p / AAC).

## Settings

- Persisted locally (music file, music volume, original volume,
  quality, output format).
