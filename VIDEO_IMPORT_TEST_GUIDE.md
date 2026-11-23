# 🧪 Video Import Testing Guide

## Quick Test (5 minutes)

### Prerequisites
- Application running on http://localhost:5173
- A test video file (MP4, MOV, AVI, MKV, etc.)

### Test Steps

#### 1. Navigate to Import Page
- [ ] Click "Import" in sidebar
- [ ] See "Import Video" heading
- [ ] See "Browse Files" button

#### 2. Select Video
- [ ] Click "Browse Files"
- [ ] Native file dialog opens
- [ ] Select a video file
- [ ] Dialog closes

#### 3. Metadata Loading
- [ ] "Loading..." button state appears
- [ ] After ~2-3 seconds, success message shows
- [ ] Video details displayed:
  - File name
  - Duration (seconds)
  - Resolution (width×height)
  - File size (MB)
  - Codec
  - FPS
  - Bitrate (Mbps)

#### 4. Dashboard Check
- [ ] Navigate to Dashboard
- [ ] "Current Video" section shows video
- [ ] Video preview displays
- [ ] Play/Pause button visible on hover
- [ ] Metadata cards show correct values
- [ ] "Your Videos" list shows imported video
- [ ] Statistics updated (1 video, duration, etc.)

#### 5. Video Preview
- [ ] Video player displays correctly
- [ ] Video dimensions correct
- [ ] Metadata panels show values
- [ ] No console errors

---

## Common Test Cases

### Test Case 1: Normal Import
**File:** MP4 video (any size)
**Expected:**
- ✓ File dialog opens
- ✓ File selected successfully
- ✓ Metadata extracted
- ✓ Video stored in list
- ✓ Dashboard updated

### Test Case 2: Different Formats
**Files:** MOV, MKV, AVI, WebM
**Expected:**
- ✓ All formats supported
- ✓ Metadata extracted for all
- ✓ No errors

### Test Case 3: Error Handling
**Action:** Click Browse, then Cancel
**Expected:**
- ✓ Error message: "User canceled selection"
- ✓ No video added
- ✓ No crash

### Test Case 4: Multiple Videos
**Action:** Import 3+ videos
**Expected:**
- ✓ All stored in list
- ✓ Can switch between them
- ✓ Last imported is current
- ✓ Dashboard shows count

### Test Case 5: Large File
**File:** 500MB+ video
**Expected:**
- ✓ Metadata loads (usually < 5s)
- ✓ File size displayed correctly
- ✓ No freezing

---

## Browser Console Checks

### Expected Console Output
```
✓ No errors
✓ No warnings about electronAPI
✓ Hot reload working (if editing files)
✓ Vite client connected
```

### What Should NOT Appear
```
❌ "electronAPI is undefined"
❌ "VIDEOSTREAM is undefined"
❌ "Cannot read property 'path' of null"
❌ "[Object Object]" errors
```

---

## UI/UX Verification

### Import Page
- [ ] Title "Import Video" visible
- [ ] Subtitle text visible
- [ ] Browse button styled correctly
- [ ] Loading state changes button text
- [ ] Success box has green styling
- [ ] Error box has red styling
- [ ] Video details formatted nicely
- [ ] Supported formats listed

### Dashboard
- [ ] 4 statistics cards visible
- [ ] Current video section centered
- [ ] Video player displays
- [ ] Metadata cards styled
- [ ] Video list scrollable
- [ ] Delete buttons visible
- [ ] Dark theme applied

### VideoPreview
- [ ] Video dimensions correct
- [ ] Play button on hover
- [ ] Metadata organized in grid
- [ ] Colors match theme
- [ ] Text readable
- [ ] No layout breaks

---

## Performance Checks

### Expected Performance
- File dialog: < 500ms
- Metadata extraction: 1-5s (depending on file)
- UI update: < 100ms
- No freezing during operations

### Performance Verification
- [ ] App responsive during import
- [ ] Can navigate while loading
- [ ] No "Not Responding" message
- [ ] Dashboard updates smoothly

---

## Edge Cases

### Edge Case 1: Very Long Video
- File: 2+ hour video
- Expected: Duration shows correctly, no freezing

### Edge Case 2: High Resolution Video
- File: 4K or 8K video
- Expected: Resolution displays, no errors

### Edge Case 3: Corrupted File
- File: Text file with .mp4 extension
- Expected: Error message appears

### Edge Case 4: Permission Denied
- File: Protected/no-read-permission file
- Expected: Error message shown

### Edge Case 5: Very Large File
- File: 10GB+ video
- Expected: Shows in list, metadata loads

---

## Mobile Responsiveness (if applicable)

- [ ] Sidebar collapses on small screens
- [ ] Video preview responsive
- [ ] Buttons accessible on mobile
- [ ] Text readable on small displays

---

## Accessibility Checks

- [ ] Tab navigation works
- [ ] All buttons have labels
- [ ] Color contrast sufficient
- [ ] Error messages clear
- [ ] No ARIA violations

---

## Browser Compatibility

### Tested Browsers
- [ ] Chrome/Chromium
- [ ] Firefox
- [ ] Safari (if on Mac)
- [ ] Edge

### Expected Results
- All should work identically
- Same dark theme
- Same functionality
- Same performance

---

## Test Results Template

```
Date: ___________
Tester: ___________
Environment: Windows / macOS / Linux
Browser: ___________
Video Format(s) Tested: ___________

✓ File Selection: PASS / FAIL
✓ Metadata Loading: PASS / FAIL
✓ Dashboard Display: PASS / FAIL
✓ VideoPreview: PASS / FAIL
✓ Error Handling: PASS / FAIL
✓ Performance: PASS / FAIL
✓ UI/UX: PASS / FAIL
✓ No Console Errors: PASS / FAIL

Overall Status: PASS / FAIL

Notes:
_________________________________
_________________________________
_________________________________
```

---

## Troubleshooting

### "Cannot select video"
- [ ] Check Electron is running
- [ ] Check file dialog permissions
- [ ] Try different video file

### "Metadata won't load"
- [ ] Check FFmpeg installed
- [ ] Try different video format
- [ ] Check file not corrupted
- [ ] Check console for errors

### "Video doesn't appear in list"
- [ ] Refresh page
- [ ] Check browser console
- [ ] Try importing again

### "Dashboard shows wrong data"
- [ ] Refresh page
- [ ] Clear browser cache
- [ ] Check Zustand state in DevTools

### "Video preview is black"
- [ ] Check video codec supported
- [ ] Check file not corrupted
- [ ] Try different video

---

## Success Criteria

✅ **ALL of the following must be true:**

1. File dialog opens and closes correctly
2. FFmpeg extracts metadata from selected video
3. Video stored in Zustand state
4. Dashboard displays video information
5. VideoPreview plays selected video
6. No TypeScript errors (npm run type-check)
7. No build errors (npm run build)
8. No console errors
9. All UI renders correctly
10. Performance is smooth

---

**Video Import Workflow Testing Complete** ✅

When all tests pass, the feature is production-ready.
