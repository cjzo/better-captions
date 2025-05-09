# Better YouTube Captions

A Chrome extension that overlays improved, high-visibility subtitles on YouTube videos. Fixes caption desync at high playback speeds and provides a clean, customizable look.

## Features

- Displays captions with better styling and centering
- More accurate syncing even at 2x+ speed
- Automatically works on videos with available subtitles
- Fallback to YouTube's live captions when transcript is unavailable
- Lightweight and does not interfere with normal YouTube functionality

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer Mode** (toggle in top right).
4. Click **Load unpacked** and select the folder containing this extension's files.
5. Visit a YouTube video page. Captions will appear automatically if available.


## Customization

To change the style of the captions, edit `styles.css`. You can tweak:

- `font-size`, `color`, `text-shadow` for readability
- Positioning with `bottom`, `left`, `transform`
- Caption outline (via multi-layer `text-shadow`)

## Roadmap

- [ ] Language selector UI
- [ ] Toggle extension on/off via popup
- [ ] Support for caption translation
- [ ] Save user preferences

## License

MIT License
