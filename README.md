# 🎬 SyncWatch — Watch Together

A minimal, self-hostable watch-party app. Watch any video URL in perfect sync with friends using real-time WebSocket synchronization.

## Features

- 🔄 **Real-time sync** — Play, pause, and seek stay perfectly synced across all viewers
- 🏠 **Room-based sessions** — Share a Room ID or invite link
- 💬 **Live chat** — Talk alongside the video
- 📱 **Mobile-friendly** — Responsive layout that works on any screen
- 🎮 **Keyboard shortcuts** — Space (play/pause), arrows (seek), M (mute), F (fullscreen)
- ⚡ **Auto-resync** — Drift correction every 10 seconds, plus a manual sync button

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# Open http://localhost:3000
```

For development with auto-restart:
```bash
npm run dev
```

## How to Use

1. **Create a room** — Enter your name and click "Create Room"
2. **Share the link** — Click the 🔗 button to copy an invite link
3. **Load a video** — Paste any direct video URL (`.mp4`, `.webm`, `.mov`, etc.)
4. **Watch together** — Play/pause/seek syncs instantly for everyone

## Sharing with friends (outside localhost)

Use a tunnel service:

```bash
# Option A: ngrok
ngrok http 3000

# Option B: Cloudflare Tunnel
cloudflared tunnel --url http://localhost:3000
```

## Video URL examples

- Direct MP4: `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4`
- Any CDN-hosted video file
- Self-hosted video servers

> Note: Videos must be publicly accessible and support CORS. YouTube/Netflix URLs won't work (use `yt-dlp` to extract direct URLs).

## Tech Stack

- **Backend**: Node.js + Express + Socket.IO
- **Frontend**: Vanilla HTML/CSS/JS (no framework dependencies)
- **Protocol**: WebSockets via Socket.IO

## Port

Default: `3000`. Override with `PORT` env var:

```bash
PORT=8080 npm start
```
