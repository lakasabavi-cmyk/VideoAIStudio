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

## Export

- Re-encodes with explicit codecs (libx264 / yuv420p / AAC).

## Settings

- Persisted locally (music file, music volume, original volume,
  quality, output format).
