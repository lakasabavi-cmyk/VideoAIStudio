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

CapCut-style composition, added 2026-11-23 and upgraded twice the
same day (pro layout, then the tool-bar / waveform / context-menu
pass). State lives in `src/stores/timelineStore.ts` (zustand
persist, key `videoai-timeline`; older saves are upgraded by
`normalizeTimeline` on mount). Video clips carry an absolute
`offset`, a `dropFirstFrame` flag and their source `fps`; audio
clips live on one of three lanes — Voice, Music, SFX — each lane
with its own start offset, and play end to end within the lane.

Editor surface:
- Real filmstrip thumbnails inside the video blocks
  (`FFmpegService.extractThumbnails`, cached under
  userData/thumb-cache) and real waveform peaks inside the audio
  blocks (`extractWaveformPeaks`, mono 4 kHz PCM peaks cached
  under userData/wave-cache). Bars are normalized to the clip's
  own loudest peak when drawn (raw amplitudes of real
  recordings are nearly invisible); a decode that produces no
  samples is logged in the App Log and never cached, and an
  all-zero cache entry is ignored and re-decoded, and every
  real decode (cache miss) is logged with its bucket count,
  sample count and max peak, so a flat waveform can be traced
  from the App Log. (Root cause of the long flat-waveform bug,
  fixed in v0.2.4: these two methods — and only these two —
  reached Electron through a dynamic `import('electron')`,
  which esbuild preserves verbatim in the CJS main bundle;
  the synthesized namespace has no `app`, so the call threw
  before decoding or logging, while every static-import
  feature kept working. Both now use the static import like
  the rest of the backend. Never reintroduce a dynamic
  `import('electron')` in this service.) On the draw side the bars are plain DOM
  elements, not a canvas — in GPU safe mode (hardware
  acceleration off) canvas painting proved unreliable on the
  target machine while the decode side verified healthy —
  and an all-zero peaks answer is treated as a failed decode
  and retried once; only a second all-zero answer is drawn
  as real silence. Resolution follows the on-screen width:
  waveform bars are requested at one per ~4 px of block
  width (64–4000 buckets, service cap 5000) and filmstrip
  frames at one per ~42 px (4–60), so long clips at wide
  zoom stay fine-grained instead of stretching a fixed
  handful of samples across the whole block.
- Ruler + red playhead; the editor has its own preview player —
  playback walks the clips, switching sources at clip boundaries,
  and the ruler seeks. Zoom goes to 600 px/s (frame level).
- Trim handles on both edges of every block (drag), drag a block
  body to reorder, and a Clip Inspector panel (in/out points,
  position, lane, volume, remove-duplicated-first-frame, remove
  clip).
- Split at Cursor: splits a clip at the playhead into two
  timeline clips. The current selection wins — with an audio clip
  selected it splits that audio clip even when the playhead also
  sits over a video clip; with nothing selected it splits the
  clip under the playhead (video first, then any audio clip).
  Video splits honor the dropped first frame when the clip's fps
  is known.
- Icon tool bar between the preview and the timeline (this
  replaced the old Edit Tools panel on the Dashboard): Trim,
  Split file, Crop, Speed, Rotate/Flip and Timeline Sheet render
  new files from the selected clip through the usual Render
  Queue jobs.
- Right-click menu on every clip: Extract First Frame, Extract
  Last Frame (both saved as PNGs into the "first frame" folder
  next to the source, via `extractFrameAt`), Upscale, RIFE
  (upscale with RIFE forced on), Remove duplicated first frame
  (toggle), Open folder (`shell:openFolder`).
- Track controls: the video track has a volume slider and
  fade-in/out; each audio lane has its own volume and fade-in/out
  on top of per-clip volume. Fades are applied per track in the
  compose graph (lanes are submixed, then faded, then mixed).
- Transitions: each video clip can carry a 0.5s transition
  into it (Inspector -> Transition in: Fade, Dissolve, Zoom,
  Slide; a fuchsia badge shows it on the block). In compose,
  the joint is rendered with xfade + acrossfade so the two
  clips overlap by 0.5s and the movie gets 0.5s shorter per
  transition; joints without a transition (and gaps) stay hard
  cuts. Clips of 0.55s or shorter cannot take a transition.
- Auto Audio Ducking (toolbar toggle): the Music lane is
  sidechain-compressed by the voice — the Voice lane mixed
  with the video clips' own audio — dipping about 12 dB while
  anyone speaks and swelling back when they stop (threshold
  0.03, ratio 6, attack 25 ms, release 450 ms; measured
  -12.4 dB on a -15 dB RMS test voice).
- Project folders: Build Movie requires a project name
  (toolbar field); the movie renders into a new folder with
  that name next to the first clip —
  <first clip folder>/<Project>/<clip>.timeline.mp4 — one
  folder per project instead of every render in one place.
- Undo / Redo: every timeline edit is recorded as a snapshot
  step (up to 60) — toolbar buttons plus Ctrl+Z / Ctrl+Shift+Z /
  Ctrl+Y (text fields keep their native undo). A pointer drag
  batches into one step; rapid bursts like typing or sliding
  coalesce into one step. History is session-only, not persisted.
- Ripple Edit toggle: on = trims/deletes/reorders reflow the
  track end to end; off = offsets stay, gaps render as black +
  silence, and a clip may not grow into its neighbour.
- Smart Concat toggle: one click sets `dropFirstFrame` on every
  clip after the first (the per-clip control is in the Inspector
  and the context menu, shown as a −1f badge). The plain Merge
  button remains the dedicated chained-clip tool; the timeline
  is fully manual.

**Build Movie** (the button's name; job kind `compose`) ->
`FFmpegService.composeTimeline`: segments are flattened in time
order with black gap fillers, every clip is normalized to the
first clip (size, fps, yuv420p) and trimmed to its kept range,
segment audio is locked to the segment's video length (same rule
as merge), and the audio bed (lanes resolved to absolute starts
by the runner, volumes multiplied by lane volume) is mixed over
with adelay + amix normalize=0, final mix `duration=first`.
Output: `<first clip>.timeline.mp4`. Audio durations/trims come
from `media:duration` (`getMediaDuration`), because
`getVideoMetadata` rejects audio-only files.

## Delete files + GPU safe mode

- Delete a file for real: the trash button on a Your Videos
  row is a two-step confirm — first click arms it ("Delete
  file?"), second click sends the file to the Windows
  Recycle Bin (`file:deleteFile` -> `shell.trashItem`, so a
  mistake is recoverable) and removes every reference: the
  library entry, the current video if it was this one, and
  any timeline video/audio clips pointing at that path. In
  the Render Queue, finished jobs with an output path get a
  second button (FileX2) with the same two-step confirm that
  deletes the OUTPUT file (trimmed / split / rendered
  leftovers) and drops the entry; the plain trash there
  still removes only the entry.
- GPU safe mode: the main process counts Chromium GPU
  process crashes (`child-process-gone`, logged under the
  `gpu` scope in the App Log). After two crashes in one run
  it arms `gpu-safemode.json` in userData; the next launch
  then disables hardware acceleration and renders in
  software. The heavy GPU work runs in external tools, so
  the UI loses almost nothing. Delete that file to
  re-enable hardware acceleration.

## Fast 4x upscale

- The 4x Real-ESRGAN model is a Settings choice ("4x model",
  shown when the scale is 4x): **Fast** (default) uses
  `realesr-animevideov3-x4` — the same lightweight video
  model family as 2x/3x, several times quicker; **Quality**
  uses `realesrgan-x4plus`, the heavy photo model that was
  previously hard-wired to 4x and made it crawl on an 8GB
  laptop GPU. Setting: `esrgan4xModel` (persisted; older
  settings without it default to Fast).

## ESRGAN model picker + sharpen pass (v0.2.0)

- Settings gains an **ESRGAN model** dropdown: Auto (the
  previous behaviour — model follows the scale, with the
  4x Fast/Quality pick), any of the six built-in models of
  the standard pack (each fixes its own scale:
  animevideov3-x2/x3/x4, realesrgan-x4plus,
  realesrgan-x4plus-anime, realesrnet-x4plus), or Custom —
  type any model name present in the models folder and use
  the scale buttons. The service already stops the job
  immediately when the model's .param file is missing.
  This answers the plastic look of the light video models:
  the photo models keep far more real detail.
- **Sharpen after upscale**: Off / Light (default) / Medium
  / Strong, applied as an ffmpeg `unsharp` pass in the
  Rebuild encode. Verified against the real service with a
  stub ESRGAN binary: edge energy 8.9 (Off) -> 15.5
  (Strong) on a test pattern.
- Version: package.json is the single source of truth
  (0.2.0); vite injects it as `__APP_VERSION__` and the
  sidebar + dashboard read it from there.

## Edit-bar controls (v0.2.1)

- The timeline's icon edit bar now hosts the clip actions
  that used to live in the Clip Inspector: a **Delete**
  button (trash icon) removes the selected video clip or
  audio clip, and a **Transition** button (ribbon/bow icon,
  highlighted fuchsia when a transition is set, labelled
  with its name) opens a small menu — None / Fade /
  Dissolve / Zoom / Slide, 0.5s each. The Remove clip /
  Remove audio buttons and the Transition-in select were
  removed from the Inspector so there is one home for them.
