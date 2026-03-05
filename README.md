# musict.space
![MIT logo](https://img.shields.io/badge/License-MIT-yellow.svg)
![pwa logo](https://img.shields.io/badge/PWA-ready-blue.svg)

MusicT.space is online pure frontend music manager. Unlike streaming services, it focuses on helping you manage and enjoy the music you already own. No installation, no upload — your music files on your storage.

Try [https://musict.space](https://musict.space) Live (Recommended: Desktop Chrome, Edge, or Opera)

Key Features:
- Local Folder Import – Select your music folder directly via the File System Access API. Never copies or uploads your files.
- Smart Metadata Completion – Automatically fetches missing titles, artists, albums, and years from MusicBrainz.
- Auto Album Artwork – Retrieves cover art from multiple sources (Cover Art Archive, iTunes, etc.) and embeds it into your library.
- Intelligent Organization – Automatically groups your music by artist and album. Say goodbye to messy file lists.
- My Playlist – One-click favorite system to build your personal collection.
- Dark Theme – A carefully designed, modern dark interface that's easy on the eyes for long listening sessions.
- 29 Languages Supported – Automatically matches your browser's language settings for a global audience.

Quick Start
- OS: Windows, macOS, or Linux
- Browser: Latest Chrome, Edge, or Opera for full folder access support.

Online Usage:
- Open [https://musict.space](https://musict.space) with a supported browser.
- Click the "Import Music" button in the sidebar.
- Import your music folder or select your muisc files.
- Wait for the scan to complete — your library will be automatically organized!
- (Optional) Click the install icon in your browser's address bar or click the "Install to Desktop" button in the top bar to add MusicT.space to your desktop.

Local Development
To run or contribute locally:
- Clone the repository
```bash
git clone https://github.com/YingRongjun/musict.space.git
cd musict.space

# Run a local server
# This is a pure static frontend project, you only need a simple HTTP server.
# For example, using Python:
python -m http.server 8000
```
Then open http://localhost:8000 in your browser.

Support the Project
If you find MusicT.space useful and would like to support its continued development, you can show your appreciation here:
[![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://www.paypal.me/MusicTspace)

Your support means a lot! ☕️ 

License
This project is licensed under the MIT License. See the LICENSE file for details.
