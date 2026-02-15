# How Subtitles Work with mpv

## Quick Answer

**Yes, mpv will automatically load subtitles** when you use the generated command. Here's how:

## Method 1: Using `--sub-file` (What This Extension Does)

The extension generates commands like this:

```bash
mpv --http-header-fields='Referer: https://example.com,Origin: https://example.com' \
    --force-window=immediate \
    --sub-auto=fuzzy \
    --sub-file='https://cdn.example.com/subtitles/english.vtt' \
    --sub-file='https://cdn.example.com/subtitles/spanish.srt' \
    'https://cdn.example.com/stream/master.m3u8'
```

### What happens:
1. mpv opens the stream
2. **All specified subtitle tracks are loaded automatically**
3. First subtitle is selected by default
4. You can switch between them with `j` key (cycle subtitles)

### To use:
1. In extension popup, **check the checkboxes** next to subtitles you want
2. Click **mpv button** on the stream
3. Paste command in terminal
4. Subtitles appear automatically!

---

## Method 2: Manual Subtitle Control in mpv

If subtitles don't auto-load or you want more control:

### During playback:
- Press `v` → cycle subtitle visibility (on/off)
- Press `j` → cycle through available subtitle tracks
- Press `J` → cycle backwards through subtitle tracks
- Press `z` / `x` → adjust subtitle delay (sync)

### Load subtitle after starting:
```bash
# Start mpv first
mpv 'https://stream.m3u8'

# Then drag-drop subtitle file onto mpv window
# OR press ` (backtick) and type:
sub-add https://cdn.example.com/subtitle.vtt
```

---

## Method 3: Subtitle Files with Headers

Some subtitle URLs need authentication headers (like the stream). The extension handles this automatically:

```bash
mpv --http-header-fields='Cookie: session=abc,Referer: https://example.com' \
    --sub-file='https://cdn.example.com/auth-protected-subtitle.vtt' \
    'https://stream.m3u8'
```

**Important:** The `--http-header-fields` applies to **all HTTP requests** mpv makes, including subtitle downloads. So if your subtitle URL needs the same headers as the stream, they're already included!

---

## Method 4: Embedded Subtitles (HLS Playlists)

Some m3u8 playlists have subtitles embedded in the manifest:

```m3u8
#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2000000,SUBTITLES="subs"
stream.m3u8
```

In this case:
- mpv **automatically detects and loads** these subtitles
- No `--sub-file` needed
- Press `j` to cycle through them

---

## Troubleshooting

### Subtitles don't appear

1. **Check if they loaded:**
   - Press `j` to cycle subtitle tracks
   - If you see "No subtitles" → they didn't load

2. **Verify URL is accessible:**
   ```bash
   curl -H 'Referer: https://example.com' 'https://subtitle-url.vtt'
   ```
   If this fails, subtitle needs headers (extension captures these automatically)

3. **Check subtitle format:**
   - mpv supports: VTT, SRT, ASS, SSA, SUB
   - If format is unsupported, convert with:
     ```bash
     ffmpeg -i subtitle.ttml subtitle.srt
     ```

4. **Force subtitle visibility:**
   ```bash
   mpv --sub-visibility=yes --sub-file='subtitle.vtt' 'stream.m3u8'
   ```

### Subtitles are out of sync

- Press `z` → delay subtitle (make it appear later)
- Press `x` → advance subtitle (make it appear earlier)
- Each press adjusts by 100ms

### Multiple subtitle tracks but only one shows

This is normal! mpv loads all tracks but only displays one at a time.

- Press `j` → switch to next subtitle track
- Press `J` → switch to previous subtitle track
- Press `v` → toggle subtitle visibility

---

## IINA-Specific Notes

IINA uses mpv internally, so everything above works. Additional IINA features:

### GUI subtitle selection:
1. Right-click video → Subtitles → Select track
2. Or use menu: Playback → Subtitles

### Add subtitle via GUI:
1. File → Load External Subtitle File
2. Or drag-drop subtitle file onto IINA window

### IINA preferences:
- Preferences → Subtitle → Auto-load external subtitles
- Set subtitle font, size, color, position

---

## Example Workflow

### Scenario: Stream with 2 subtitle tracks

1. **Extension popup shows:**
   - 🟠 Stream: `master.m3u8`
   - 🔵 Subtitle: `english.vtt` 🌐 English (detected) ☑️
   - 🔵 Subtitle: `spanish.srt` 🌐 Spanish (detected) ☑️

2. **Quick select with "Select all" button:**
   - Click "Select all" to check all subtitle checkboxes at once
   - Click again to deselect all

3. **Click mpv button → generates:**
   ```bash
   mpv --http-header-fields='...' \
       --sub-file='https://.../english.vtt' \
       --sub-file='https://.../spanish.srt' \
       'https://.../master.m3u8'
   ```

4. **Run command → mpv opens with:**
   - Video playing
   - English subtitles visible by default
   - Press `j` → switches to Spanish
   - Press `j` again → no subtitles
   - Press `j` again → back to English

---

## Advanced: Subtitle Styling

### Change subtitle font/size:
```bash
mpv --sub-font='Arial' --sub-font-size=55 --sub-file='subtitle.vtt' 'stream.m3u8'
```

### Change subtitle position:
```bash
mpv --sub-pos=90 --sub-file='subtitle.vtt' 'stream.m3u8'
```
(90 = near bottom, 10 = near top)

### Subtitle with background:
```bash
mpv --sub-back-color='#000000' --sub-border-size=2 --sub-file='subtitle.vtt' 'stream.m3u8'
```

---

## Summary

✅ **Subtitles ARE automatically loaded** when you use `--sub-file`  
✅ **Headers are shared** between stream and subtitle requests  
✅ **Multiple subtitles work** - cycle with `j` key  
✅ **Works in both mpv and IINA**  

**Just check the subtitle checkboxes in the extension popup before clicking mpv button!**
