# Troubleshooting

- **Worker not running / rendering or wizard broken**  
  *Symptom*: Rendering or the wizard does nothing.  
  *Cause*: You opened `index.html` as a file instead of starting the dev server.  
  *Fix*: Run `npm run dev` – this starts Vite and the local media worker.

- **ffmpeg / ffprobe missing**  
  *Symptom*: Render errors mentioning ffmpeg or ffprobe.  
  *Cause*: ffmpeg and ffprobe are not installed at `/usr/bin`.  
  *Fix*: Install ffmpeg (e.g., via your package manager) and verify both binaries are in `/usr/bin`.

- **Chromium / Chrome not found**  
  *Symptom*: Rendering fails with a browser-related error.  
  *Cause*: The environment variable `HERMEST_CHROME_PATH` is not set or points to a missing binary.  
  *Fix*: Install Chromium/Chrome and set `HERMEST_CHROME_PATH` to its full path (e.g., `/usr/bin/chromium`).

- **Piper TTS or voices missing**  
  *Symptom*: Text-to-speech does not work, or piper-related errors appear.  
  *Cause*: Piper and its voices are not installed.  
  *Fix*: Run `scripts/install-piper-ci.sh` – it installs piper to `~/.local/opt/piper/piper` and voices to `~/.local/share/piper/voices`.

- **Voice status shows “voice_missing” for a language**  
  *Symptom*: A language displays `voice_missing` in the UI.  
  *Cause*: No free piper voice exists for that language (only ru_RU, en_US, es_ES, de_DE, fr_FR are free).  
  *Fix*: Switch to a supported language, or provide an ElevenLabs API key (`HERMEST_ELEVENLABS_API_KEY`) for premium voices.

- **Port already in use**  
  *Symptom*: Error that port 5173 (dev) or 8080 (self-host) is occupied.  
  *Cause*: Another process is using the port.  
  *Fix*: Kill the process (e.g., `lsof -ti:5173 | xargs kill`) and retry. For self-host, you can set a different port: `PORT=3000 npx vite preview --host 0.0.0.0`.

- **Node.js version too old**  
  *Symptom*: Build or runtime errors about unsupported Node features.  
  *Cause*: Node.js version is below 20 or above 22.  
  *Fix*: Install Node.js version 20, 21, or 22 (>=20 and <23).
