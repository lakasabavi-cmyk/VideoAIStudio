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

- A compact live panel pinned to the bottom of the left
  sidebar (moved there 2026-11-23 so it is visible from every
  tab), refreshed every 2 seconds: CPU load, RAM used/total,
  GPU utilisation, VRAM used/total and GPU temperature (via
  nvidia-smi; needs the NVIDIA driver). CPU temperature is
  appended to the CPU row when Windows exposes it via WMI.
  Bars turn amber at 70% and red at 90% (or when the GPU
  reaches 85°C).

## Settings layout (2026-11-23)

- Inside the Upscale card, the RIFE block sits ABOVE the
  Real-ESRGAN scale/path fields, mirroring the pipeline order
  (interpolation runs before the upscale).

## Cancel a running job (added 2026-11-23)

- The processing job in the Render Queue has a red Cancel
  button (the trash button returns when the job is done).
  Cancelling kills the job's processes immediately — the
  ffmpeg encode, or the Real-ESRGAN / RIFE frame tool — and a
  multi-stage upscale also stops between stages instead of
  starting the next one. The job is recorded as "cancelled"
  with how long it ran, not as failed. There is no Pause:
  Windows cannot reliably suspend these external tools, so
  cancel-and-restart replaces it.

## App Log viewer (added 2026-11-23)

- The main process keeps an append-only log on disk
  (userData/logs/videoai-YYYY-MM-DD.log), written with
  synchronous appends so it survives even a full machine
  shutdown — a chained 2x-then-4x upscale shut Hung's whole PC
  down at 73% and the in-app error line died with it.
- Logged: app start, every job's completion/failure, frame
  tool failures with their stderr tail, upscale start (input,
  size, scale, model, tile, RIFE), stage transitions, and a
  system-stats sample every 10s during upscale jobs (CPU, RAM,
  GPU util, VRAM, GPU temp) so the load right before a death
  is on record.
- Settings page → App Log (bottom of the page): shows the
  last 300 lines, auto-refreshes every 5s, with Refresh and
  Open Log File buttons.

## Real-ESRGAN tile size — memory control (added 2026-11-23)

- Settings → Upscale (Real-ESRGAN) → Tile size: Auto / 400 /
  256 / 128. Passed to the ncnn binary as -t. Auto leaves the
  binary free to hold a whole large frame in VRAM; on an 8GB
  card a chained 2x-then-4x upscale died out-of-memory at 73%.
  256 (or 128) caps per-tile memory at a small speed cost.

## Edit Tools — Trim, Split, Crop, Speed, Rotate/Flip, Thumbnails (added 2026-11-23)

- A panel under the Current Video on the Dashboard; every action
  is a normal queue job and writes next to the source file.
- Trim: [start, end] seconds, re-encoded so cuts are
  frame-accurate. Output name.trim.mp4.
- Split Clip: either one cut at a point (part1/part2) or every
  N seconds (part000, part001, ...), into a "<name>_parts"
  folder. Segments are cut as a loop of frame-accurate trims —
  the ffmpeg segment muxer was tried and rejected: on the
  bundled build it skips the first keyframe boundary (a 12s
  clip at 4s segments came out as 8s + 4s).
- Crop: centre presets 9:16 / 1:1 / 16:9 fill the x/y/w/h
  fields; any rectangle can be typed. Output name.crop.mp4.
- Speed: 0.25x-4x chips; setpts for video, chained atempo
  (0.5-2.0 per stage) for audio. Output name.speed2x.mp4 etc.
- Rotate / Flip: 90 CW (transpose=1), 90 CCW (transpose=2),
  180 (hflip+vflip), Flip H, Flip V. Output name.rot90.mp4 etc.
- Timeline Thumbnails: one PNG contact sheet, 10 frames
  sampled evenly across the clip in a 5x2 tile.
  Output name.timeline.png.

## Export

- Re-encodes with explicit codecs (libx264 / yuv420p / AAC).

## Settings

- Persisted locally (music file, music volume, original volume,
  quality, output format).

## Timeline Editor (Dashboard, under Current Video)

CapCut-style composition, added 2026-11-23, upgraded to the pro
layout the same day. State lives in `src/stores/timelineStore.ts`
(zustand persist, key `videoai-timeline`; v1 saves are upgraded by
`normalizeTimeline` on mount). Video clips carry an absolute
`offset` and a `dropFirstFrame` flag; audio clips live on one of
three lanes — Voice, Music, SFX — each lane with its own start
offset, and play end to end within the lane.

Editor surface:
- Real filmstrip thumbnails inside the video blocks
  (`FFmpegService.extractThumbnails`, cached under
  userData/thumb-cache, keyed by path + kept range + count).
- Ruler + red playhead; the editor has its own preview player —
  playback walks the clips, switching sources at clip boundaries,
  and the ruler seeks.
- Zoom slider (px per second), trim handles on both edges of
  every block (drag), drag a block body to reorder, and a Clip
  Inspector panel (in/out points, position, lane, volume,
  remove-first-frame, remove clip).
- Ripple Edit toggle: on = trims/deletes/reorders reflow the
  track end to end; off = offsets stay, gaps render as black +
  silence, and a clip may not grow into its neighbour.
- Smart Concat toggle: one click sets `dropFirstFrame` on every
  clip after the first (the per-clip -1f control is in the
  Inspector and shown as a badge). The plain Merge button remains
  the dedicated chained-clip tool; the timeline is fully manual.

**Build Movie** (the button's name; job kind `compose`) ->
`FFmpegService.composeTimeline` v2: segments are flattened in
time order with black gap fillers, every clip is normalized to
the first clip (size, fps, yuv420p) and trimmed to its kept
range, segment audio is locked to the segment's video length
(same rule as merge), and the audio bed (all lanes resolved to
absolute starts by the runner) is mixed over with adelay + amix
normalize=0, final mix `duration=first`. Output:
`<first clip>.timeline.mp4`. Audio durations/trims come from
`media:duration` (`getMediaDuration`), because
`getVideoMetadata` rejects audio-only files.
