class MusicPlayer {
    constructor() {
        this.audioElement = new Audio();
        this.currentTrack = null;
        this.playlist = [];
        this.filteredPlaylist = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.playMode = 'repeat';
        
        const savedVolume = localStorage.getItem('musicPlayerVolume');
        this.volume = savedVolume !== null ? parseFloat(savedVolume) : 0.7;
        
        this.favorites = new Set();
        this.currentView = 'all';
        this.db = null;
        this.currentPage = 1;
        this.pageSize = 20;
        this.selectedSongs = new Set();
        this.selectAllCheckbox = null;
        this.hasRestoredLastSongPage = false;
        this.viewSelectionState = {
            all: new Set(),
            artist: new Set(),
            album: new Set(),
            favorites: new Set()
        };
        this.currentFilter = null;
        this.currentFilterType = null;
        this.artistMenuExpanded = false;
        this.albumMenuExpanded = false;
        this.searchQuery = '';
        this.isComposing = false;
        this.isDraggingProgress = false;
        this.isDraggingVolume = false;
        this.deletedTrackId = null;
        this.deletedTrackIndex = null;
        this.parsedLyrics = [];
        this.currentLyricIndex = -1;
        this.lyricsQueue = [];
        this.isProcessingLyricsQueue = false;
        
        this.init();
    }

    async init() {
        await this.initDB();
        this.initEventListeners();
        this.loadFavorites();
        await this.loadSongsFromDB();
        this.initCheckboxListeners();
        this.updateUI();
        
        this.audioElement.volume = this.volume;
        
        const volumeFill = document.getElementById('volumeFill');
        const volumeThumb = document.getElementById('volumeThumb');
        volumeFill.style.width = `${this.volume * 100}%`;
        volumeThumb.style.left = `${this.volume * 100}%`;
        this.updateVolumeIcon();
        
        this.restoreSavedView();
    }
    
    restoreSavedView() {
        const savedViewData = localStorage.getItem('musicPlayerView');
        if (!savedViewData) {
            this.switchView('all');
            return;
        }
        
        try {
            const { view, filter } = JSON.parse(savedViewData);
            
            if (filter && (view === 'artist' || view === 'album')) {
                const exists = this.playlist.some(song => 
                    view === 'artist' ? song.artist === filter : song.album === filter
                );
                
                if (exists) {
                    this.filterBySubmenu(view, filter);
                    return;
                }
            }
            
            this.switchView(view || 'all');
        } catch (e) {
            this.switchView('all');
        }
    }
    
    restoreLastSongPage() {
        if (this.hasRestoredLastSongPage) return;
        
        const lastPlayedSongId = localStorage.getItem('musicPlayerLastSong');
        if (lastPlayedSongId) {
            const songIndex = this.filteredPlaylist.findIndex(s => s.id === lastPlayedSongId);
            if (songIndex !== -1) {
                this.currentPage = Math.floor(songIndex / this.pageSize) + 1;
            }
        }
        this.hasRestoredLastSongPage = true;
    }

    async loadSongsFromDB() {
        try {
            const songs = await fileSystemHandler.loadAllSongs();
            
            this.playlist = songs.map(song => ({
                id: song.id,
                title: song.metadata.title,
                artist: song.metadata.artist,
                album: song.metadata.album,
                year: song.metadata.year,
                duration: song.metadata.duration,
                hasCover: song.metadata.hasCover,
                coverId: song.coverId,
                releases: song.metadata.releases,
                lyrics: song.lyrics,
                file: null,
                handle: song.handle,
                name: song.name,
                path: song.path
            }));
            
            this.filteredPlaylist = [...this.playlist];
            
            const contentTitle = document.getElementById('contentTitle');
            contentTitle.textContent = `${i18n.t('contentTitle.allSongs')} (${i18n.t('contentTitle.songCount', { count: this.playlist.length })})`;
            
            this.updateNavigation();
            
            console.log(`Loaded ${this.playlist.length} songs to playlist`);
        } catch (error) {
            console.error('Failed to load songs:', error);
        }
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('MusicTDB', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('songs')) {
                    db.createObjectStore('songs', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('favorites')) {
                    db.createObjectStore('favorites', { keyPath: 'id' });
                }
            };
        });
    }

    initEventListeners() {
        document.getElementById('importBtn').addEventListener('click', () => this.showImportModal());
        document.getElementById('modalClose').addEventListener('click', () => this.hideImportModal());
        document.getElementById('importFolder').addEventListener('click', () => this.importFromFolder());
        document.getElementById('importFile').addEventListener('click', () => this.importFromFile());
        
        document.getElementById('importModal').addEventListener('click', (e) => {
            if (e.target.id === 'importModal') {
                this.hideImportModal();
            }
        });

        document.getElementById('importProgressClose').addEventListener('click', () => {
            this.hideImportProgressModal();
        });

        document.getElementById('cancelImportBtn').addEventListener('click', () => {
            fileSystemHandler.cancelImportOperation();
            this.hideImportProgressModal();
        });
        
        const langSelectorBtn = document.getElementById('langSelectorBtn');
        const langModal = document.getElementById('langModal');
        const langModalBody = document.getElementById('langModalBody');
        
        if (langSelectorBtn && langModal) {
            langSelectorBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                langModal.classList.toggle('show');
                langSelectorBtn.classList.toggle('active');
            });
            
            langModal.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            
            document.addEventListener('click', () => {
                langModal.classList.remove('show');
                langSelectorBtn.classList.remove('active');
            });
        }
        
        if (langModalBody) {
            langModalBody.addEventListener('click', (e) => {
                const btn = e.target.closest('.lang-option');
                if (btn) {
                    const lang = btn.dataset.lang;
                    i18n.changeLanguage(lang);
                    langModal.classList.remove('show');
                    langSelectorBtn.classList.remove('active');
                }
            });
        }
        
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const view = e.currentTarget.dataset.view;
                
                if (view === 'artist' || view === 'album') {
                    this.toggleSubmenu(view);
                } else {
                    this.switchView(view);
                }
            });
        });
        
        document.getElementById('playAllBtn').addEventListener('click', () => this.playAll());
        
        const searchInput = document.getElementById('searchInput');
        const searchClearBtn = document.getElementById('searchClearBtn');
        
        searchInput.addEventListener('compositionstart', () => {
            this.isComposing = true;
        });
        
        searchInput.addEventListener('compositionend', (e) => {
            this.isComposing = false;
            this.searchQuery = e.target.value.trim();
            this.performSearch();
            this.updateClearButton();
        });
        
        searchInput.addEventListener('input', (e) => {
            if (!this.isComposing) {
                this.searchQuery = e.target.value.trim();
                this.performSearch();
                this.updateClearButton();
            }
        });
        
        searchClearBtn.addEventListener('click', () => {
            searchInput.value = '';
            this.searchQuery = '';
            this.performSearch();
            this.updateClearButton();
        });
        
        document.getElementById('prevPageBtn').addEventListener('click', () => this.goToPrevPage());
        document.getElementById('nextPageBtn').addEventListener('click', () => this.goToNextPage());
        
        document.getElementById('addToFavoritesBtn').addEventListener('click', () => this.addSelectedToFavorites());
        document.getElementById('deleteFromLibraryBtn').addEventListener('click', () => this.deleteSelectedFromLibrary());
        document.getElementById('deleteFromFavoritesBtn').addEventListener('click', () => this.deleteSelectedFromFavorites());
        
        document.getElementById('playBtn').addEventListener('click', () => this.togglePlay());
        document.getElementById('prevBtn').addEventListener('click', () => this.playPrevious());
        document.getElementById('nextBtn').addEventListener('click', () => this.playNext());
        document.getElementById('playModeBtn').addEventListener('click', () => this.togglePlayMode());
        
        const controlBtns = document.querySelectorAll('.player-controls .control-btn');
        controlBtns.forEach(btn => {
            btn.addEventListener('mouseenter', (e) => {
                const title = btn.getAttribute('title');
                if (title) {
                    btn.dataset.title = title;
                    btn.removeAttribute('title');
                    this.showControlTooltip(e, title);
                } else if (btn.dataset.title) {
                    this.showControlTooltip(e, btn.dataset.title);
                }
            });
            btn.addEventListener('mouseleave', () => {
                this.hideTooltip();
            });
        });
        
        document.getElementById('volumeBtn').addEventListener('click', () => this.toggleMute());
        document.querySelector('.volume-bar').addEventListener('click', (e) => this.setVolumeByPosition(e));
        
        this.initVolumeThumbDrag();
        
        this.audioElement.addEventListener('timeupdate', () => this.updateProgress());
        this.audioElement.addEventListener('ended', () => this.onTrackEnd());
        this.audioElement.addEventListener('loadedmetadata', () => this.updateTrackInfo());
        
        document.querySelector('.progress-bar').addEventListener('click', (e) => this.seekTo(e));
        
        this.initProgressThumbDrag();
        
        window.addEventListener('resize', () => {
            this.updateScrollbar();
        });

        window.addEventListener('songMetadataUpdated', (e) => {
            this.onSongMetadataUpdated(e.detail);
        });

        window.addEventListener('songCoverUpdated', (e) => {
            this.onSongCoverUpdated(e.detail);
        });

        window.addEventListener('songReleasesUpdated', (e) => {
            this.onSongReleasesUpdated(e.detail);
        });

        window.addEventListener('songAlbumUpdated', (e) => {
            this.onSongAlbumUpdated(e.detail);
        });

        window.addEventListener('localeChanged', () => {
            this.updatePlayModeUI();
            this.updateContentTitle();
            this.renderSongList();
            this.updateLyricsDisplay();
        });
    }

    initProgressThumbDrag() {
        const progressThumb = document.getElementById('progressThumb');
        const progressFill = document.getElementById('progressFill');
        const progressBar = document.querySelector('.progress-bar');
        
        progressThumb.addEventListener('mousedown', (e) => {
            this.isDraggingProgress = true;
            progressThumb.classList.add('dragging');
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!this.isDraggingProgress) return;
            
            const rect = progressBar.getBoundingClientRect();
            let x = e.clientX - rect.left;
            x = Math.max(0, Math.min(x, rect.width));
            const percentage = x / rect.width;
            
            progressFill.style.width = `${percentage * 100}%`;
            progressThumb.style.left = `${percentage * 100}%`;
            document.getElementById('currentTime').textContent = this.formatTime(percentage * this.audioElement.duration);
        });
        
        document.addEventListener('mouseup', (e) => {
            if (this.isDraggingProgress) {
                const rect = progressBar.getBoundingClientRect();
                let x = e.clientX - rect.left;
                x = Math.max(0, Math.min(x, rect.width));
                const percentage = x / rect.width;
                
                this.audioElement.currentTime = percentage * this.audioElement.duration;
                
                this.isDraggingProgress = false;
                progressThumb.classList.remove('dragging');
            }
        });
    }

    initVolumeThumbDrag() {
        const volumeThumb = document.getElementById('volumeThumb');
        const volumeFill = document.getElementById('volumeFill');
        const volumeBar = document.querySelector('.volume-bar');
        
        volumeThumb.addEventListener('mousedown', (e) => {
            this.isDraggingVolume = true;
            volumeThumb.classList.add('dragging');
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!this.isDraggingVolume) return;
            
            const rect = volumeBar.getBoundingClientRect();
            let x = e.clientX - rect.left;
            x = Math.max(0, Math.min(x, rect.width));
            const percentage = x / rect.width;
            
            volumeFill.style.width = `${percentage * 100}%`;
            volumeThumb.style.left = `${percentage * 100}%`;
            
            this.volume = percentage;
            this.audioElement.volume = percentage;
            this.updateVolumeIcon();
        });
        
        document.addEventListener('mouseup', (e) => {
            if (this.isDraggingVolume) {
                this.isDraggingVolume = false;
                volumeThumb.classList.remove('dragging');
                localStorage.setItem('musicPlayerVolume', this.volume);
            }
        });
    }

    setVolumeByPosition(e) {
        const volumeBar = document.querySelector('.volume-bar');
        const rect = volumeBar.getBoundingClientRect();
        let x = e.clientX - rect.left;
        x = Math.max(0, Math.min(x, rect.width));
        const percentage = x / rect.width;
        
        this.setVolume(percentage * 100);
    }

    initCheckboxListeners() {
        this.selectAllCheckbox = document.getElementById('selectAllCheckbox');
        
        this.selectAllCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const checkboxes = document.querySelectorAll('.song-checkbox');
            
            checkboxes.forEach(checkbox => {
                checkbox.checked = isChecked;
                const songId = checkbox.dataset.id;
                if (isChecked) {
                    this.selectedSongs.add(songId);
                } else {
                    this.selectedSongs.delete(songId);
                }
            });
            
            this.saveSelectionState();
            this.updateActionButtons();
        });
    }
    
    updateSelectAllCheckbox() {
        if (!this.selectAllCheckbox) return;
        
        const checkboxes = document.querySelectorAll('.song-checkbox');
        const totalCheckboxes = checkboxes.length;
        const checkedCheckboxes = document.querySelectorAll('.song-checkbox:checked').length;
        
        if (totalCheckboxes === 0) {
            this.selectAllCheckbox.checked = false;
            this.selectAllCheckbox.indeterminate = false;
        } else if (checkedCheckboxes === totalCheckboxes) {
            this.selectAllCheckbox.checked = true;
            this.selectAllCheckbox.indeterminate = false;
        } else if (checkedCheckboxes > 0) {
            this.selectAllCheckbox.checked = false;
            this.selectAllCheckbox.indeterminate = true;
        } else {
            this.selectAllCheckbox.checked = false;
            this.selectAllCheckbox.indeterminate = false;
        }
    }
    
    clearAllCheckboxes() {
        const checkboxes = document.querySelectorAll('.song-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
        
        if (this.selectAllCheckbox) {
            this.selectAllCheckbox.checked = false;
            this.selectAllCheckbox.indeterminate = false;
        }
        
        this.saveSelectionState();
    }
    
    updateActionButtons() {
        const addToFavoritesBtn = document.getElementById('addToFavoritesBtn');
        const deleteFromLibraryBtn = document.getElementById('deleteFromLibraryBtn');
        const deleteFromFavoritesBtn = document.getElementById('deleteFromFavoritesBtn');
        
        const hasSelection = this.selectedSongs.size > 0;
        
        addToFavoritesBtn.style.display = 'none';
        deleteFromLibraryBtn.style.display = 'none';
        deleteFromFavoritesBtn.style.display = 'none';
        
        if (!hasSelection) return;
        
        if (this.currentView === 'favorites') {
            deleteFromFavoritesBtn.style.display = 'flex';
        } else {
            addToFavoritesBtn.style.display = 'flex';
            deleteFromLibraryBtn.style.display = 'flex';
        }
    }
    
    async addSelectedToFavorites() {
        if (this.selectedSongs.size === 0) return;
        
        const count = this.selectedSongs.size;
        
        this.selectedSongs.forEach(songId => {
            this.favorites.add(songId);
        });
        
        await this.saveFavorites();
        this.renderSongList();
        this.selectedSongs.clear();
        this.clearAllCheckboxes();
        this.updateActionButtons();
        
        console.log(i18n.t('notifications.addedToPlaylist', { count }));
    }

    stopPlayback() {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
        this.isPlaying = false;
        this.currentTrack = null;
        this.parsedLyrics = [];
        this.currentLyricIndex = -1;
        
        localStorage.removeItem('musicPlayerLastSong');
        
        const lyricsContent = document.getElementById('lyricsContent');
        if (lyricsContent) {
            lyricsContent.innerHTML = `<div class="lyrics-placeholder">${i18n.t('player.noLyrics')}</div>`;
        }
        
        this.updateUI();
    }

    handleDeletedCurrentTrack(songIds) {
        if (!this.currentTrack || !songIds.includes(this.currentTrack.id)) {
            return false;
        }
        
        if (this.playMode === 'one') {
            this.stopPlayback();
            return false;
        }
        
        this.deletedTrackIndex = this.filteredPlaylist.findIndex(s => s.id === this.currentTrack.id);
        this.deletedTrackId = this.currentTrack.id;
        return true;
    }
    
    playNextAfterDelete() {
        const deletedIndex = this.deletedTrackIndex;
        this.deletedTrackIndex = null;
        this.deletedTrackId = null;
        
        if (this.filteredPlaylist.length === 0) {
            this.stopPlayback();
            return;
        }
        
        let nextIndex = 0;
        if (this.playMode === 'shuffle') {
            nextIndex = Math.floor(Math.random() * this.filteredPlaylist.length);
        } else {
            nextIndex = deletedIndex >= this.filteredPlaylist.length ? 0 : deletedIndex;
        }
        
        this.currentTrack = null;
        this.playSong(this.filteredPlaylist[nextIndex]);
    }
    
    async deleteSelectedFromLibrary() {
        if (this.selectedSongs.size === 0) return;
        
        const confirmed = await this.showConfirmDialog(
            i18n.t('confirm.deleteFromLibrary'),
            i18n.t('confirm.deleteFromLibraryDesc', { count: this.selectedSongs.size })
        );
        
        if (!confirmed) return;
        
        const songIds = Array.from(this.selectedSongs);
        const shouldPlayNext = this.handleDeletedCurrentTrack(songIds);
        
        const lastPlayedSongId = localStorage.getItem('musicPlayerLastSong');
        if (lastPlayedSongId && songIds.includes(lastPlayedSongId)) {
            localStorage.removeItem('musicPlayerLastSong');
        }
        
        const wasFilteredView = this.currentFilterType && (this.currentFilterType === 'artist' || this.currentFilterType === 'album');
        const currentFilter = this.currentFilter;
        const currentFilterType = this.currentFilterType;
        
        await fileSystemHandler.deleteSongs(songIds);
        
        this.selectedSongs.clear();
        this.clearAllCheckboxes();
        await this.loadSongsFromDB();
        this.updateActionButtons();
        
        if (wasFilteredView) {
            const remainingSongs = this.playlist.filter(s => {
                if (currentFilterType === 'artist') {
                    return s.artist === currentFilter;
                } else if (currentFilterType === 'album') {
                    return s.album === currentFilter;
                }
                return false;
            });
            
            if (remainingSongs.length > 0) {
                this.filterBySubmenu(currentFilterType, currentFilter);
            } else {
                this.switchView(currentFilterType);
                this.updateNavigation();
            }
        } else {
            this.performSearch();
        }
        
        if (shouldPlayNext) {
            this.playNextAfterDelete();
        }
        
        console.log(i18n.t('notifications.deletedFromLibrary', { count: songIds.length }));
    }
    
    async deleteSelectedFromFavorites() {
        if (this.selectedSongs.size === 0) return;
        
        const count = this.selectedSongs.size;
        
        const confirmed = await this.showConfirmDialog(
            i18n.t('confirm.deleteFromPlaylist'),
            i18n.t('confirm.deleteFromPlaylistDesc', { count })
        );
        
        if (!confirmed) return;
        
        const songIds = Array.from(this.selectedSongs);
        const shouldPlayNext = this.handleDeletedCurrentTrack(songIds);
        
        this.selectedSongs.forEach(songId => {
            this.favorites.delete(songId);
        });
        
        this.selectedSongs.clear();
        this.clearAllCheckboxes();
        await this.saveFavorites();
        this.filterPlaylist();
        this.restoreSelectionState('favorites');
        this.performSearch();
        this.renderSongList();
        this.updateActionButtons();
        
        if (shouldPlayNext) {
            this.playNextAfterDelete();
        }
        
        console.log(i18n.t('notifications.removedFromPlaylist', { count }));
    }
    
    async deleteFromFavorites(songId) {
        const song = this.playlist.find(s => s.id === songId);
        if (!song) return;
        
        const confirmed = await this.showConfirmDialog(
            i18n.t('confirm.deleteFromPlaylist'),
            i18n.t('confirm.deleteSongFromPlaylist', { title: song.title })
        );
        
        if (!confirmed) return;
        
        const shouldPlayNext = this.handleDeletedCurrentTrack([songId]);
        
        this.favorites.delete(songId);
        await this.saveFavorites();
        this.filterPlaylist();
        this.restoreSelectionState('favorites');
        this.performSearch();
        this.renderSongList();
        
        if (shouldPlayNext) {
            this.playNextAfterDelete();
        }
        
        console.log(i18n.t('notifications.deletedSongFromPlaylist', { title: song.title }));
    }
    
    async deleteFromLibrary(songId) {
        const song = this.playlist.find(s => s.id === songId);
        if (!song) return;
        
        const confirmed = await this.showConfirmDialog(
            i18n.t('confirm.deleteFromLibrary'),
            i18n.t('confirm.deleteSongFromLibrary', { title: song.title })
        );
        
        if (!confirmed) return;
        
        const shouldPlayNext = this.handleDeletedCurrentTrack([songId]);
        
        const lastPlayedSongId = localStorage.getItem('musicPlayerLastSong');
        if (lastPlayedSongId === songId) {
            localStorage.removeItem('musicPlayerLastSong');
        }
        
        const wasFilteredView = this.currentFilterType && (this.currentFilterType === 'artist' || this.currentFilterType === 'album');
        const currentFilter = this.currentFilter;
        const currentFilterType = this.currentFilterType;
        
        await fileSystemHandler.deleteSongs([songId]);
        await this.loadSongsFromDB();
        
        if (wasFilteredView) {
            const remainingSongs = this.playlist.filter(s => {
                if (currentFilterType === 'artist') {
                    return s.artist === currentFilter;
                } else if (currentFilterType === 'album') {
                    return s.album === currentFilter;
                }
                return false;
            });
            
            if (remainingSongs.length > 0) {
                this.filterBySubmenu(currentFilterType, currentFilter);
            } else {
                this.switchView(currentFilterType);
                this.updateNavigation();
            }
        } else {
            this.performSearch();
        }
        
        if (shouldPlayNext) {
            this.playNextAfterDelete();
        }
        
        console.log(i18n.t('notifications.deletedSongFromLibrary', { title: song.title }));
    }

    showImportModal() {
        document.getElementById('importModal').classList.add('show');
    }

    hideImportModal() {
        document.getElementById('importModal').classList.remove('show');
    }

    showImportProgressModal() {
        document.getElementById('importProgressModal').classList.add('show');
    }

    hideImportProgressModal() {
        document.getElementById('importProgressModal').classList.remove('show');
    }
    
    showConfirmDialog(title, message) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirmModal');
            const titleEl = document.getElementById('confirmTitle');
            const messageEl = document.getElementById('confirmMessage');
            const cancelBtn = document.getElementById('confirmCancel');
            const okBtn = document.getElementById('confirmOk');
            
            titleEl.textContent = title;
            messageEl.textContent = message;
            
            const closeHandler = () => {
                modal.classList.remove('show');
                cancelBtn.removeEventListener('click', cancelHandler);
                okBtn.removeEventListener('click', okHandler);
            };
            
            const cancelHandler = () => {
                closeHandler();
                resolve(false);
            };
            
            const okHandler = () => {
                closeHandler();
                resolve(true);
            };
            
            cancelBtn.addEventListener('click', cancelHandler);
            okBtn.addEventListener('click', okHandler);
            
            document.getElementById('confirmClose').addEventListener('click', cancelHandler);
            
            modal.addEventListener('click', (e) => {
                if (e.target.id === 'confirmModal') {
                    cancelHandler();
                }
            });
            
            modal.classList.add('show');
        });
    }

    resetImportProgress() {
        const progressCount = document.getElementById('importProgressCount');
        const progressPercentage = document.getElementById('importProgressPercentage');
        const progressStatus = document.getElementById('importProgressStatus');
        const progressBar = document.getElementById('importProgressBar');

        progressCount.textContent = '0 / 0';
        progressPercentage.textContent = '0%';
        progressStatus.textContent = i18n.t('import.preparing');
        progressBar.style.width = '0%';
    }

    updateImportProgress(stage, data) {
        const progressCount = document.getElementById('importProgressCount');
        const progressPercentage = document.getElementById('importProgressPercentage');
        const progressStatus = document.getElementById('importProgressStatus');
        const progressBar = document.getElementById('importProgressBar');

        switch (stage) {
            case 'start':
                this.resetImportProgress();
                this.showImportProgressModal();
                break;
            case 'scan':
                progressCount.textContent = i18n.t('import.scanningFiles');
                progressPercentage.textContent = '0%';
                progressStatus.textContent = i18n.t('import.scanningPath', { path: data.path });
                progressBar.style.width = '10%';
                break;
            case 'parse':
                const percentage = Math.round((data.current / data.total) * 100);
                progressCount.textContent = `${data.current} / ${data.total}`;
                progressPercentage.textContent = `${percentage}%`;
                progressStatus.textContent = i18n.t('import.parsing', { file: data.file });
                progressBar.style.width = `${percentage}%`;
                break;
            case 'save':
                progressCount.textContent = i18n.t('import.saving');
                progressPercentage.textContent = '95%';
                progressStatus.textContent = i18n.t('import.writingDb');
                progressBar.style.width = '95%';
                break;
            case 'complete':
                progressCount.textContent = i18n.t('import.complete');
                progressPercentage.textContent = '100%';
                progressStatus.textContent = i18n.t('import.finished');
                progressBar.style.width = '100%';
                break;
        }
    }

    async importFromFolder() {
        try {
            this.hideImportModal();
            
            const audioFiles = await fileSystemHandler.importFromFolder(
                (stage, data) => {
                    this.updateImportProgress(stage, data);
                },
                async (files, stats) => {
                    this.updateImportProgress('complete');
                    
                    files.forEach(file => {
                        console.log(`File: ${file.title} - ${file.artist}`);
                    });
                    
                    if (stats) {
                        console.log(i18n.t('import.saved', { new: stats.newCount, dup: stats.duplicateCount }));
                    }
                    
                    this.selectedSongs.clear();
                    await this.loadSongsFromDB();
                    this.performSearch();
                    
                    this.hideImportProgressModal();
                }
            );
        } catch (error) {
            if (error.name !== 'AbortError' && error.message !== 'Import cancelled') {
                console.error('Import error:', error);
                alert(i18n.t('import.failed', { error: error.message }));
                this.hideImportProgressModal();
            } else {
                console.log(i18n.t('import.cancelled'));
                this.hideImportProgressModal();
            }
        }
    }

    async importFromFile() {
        try {
            this.hideImportModal();
            
            const audioFiles = await fileSystemHandler.importFromFiles(
                (stage, data) => {
                    this.updateImportProgress(stage, data);
                },
                async (files, stats) => {
                    this.updateImportProgress('complete');
                    
                    files.forEach(file => {
                        console.log(`File: ${file.title} - ${file.artist}`);
                    });
                    
                    if (stats) {
                        console.log(i18n.t('import.saved', { new: stats.newCount, dup: stats.duplicateCount }));
                    }
                    
                    this.selectedSongs.clear();
                    await this.loadSongsFromDB();
                    this.performSearch();
                    
                    this.hideImportProgressModal();
                }
            );
        } catch (error) {
            if (error.name !== 'AbortError' && error.message !== 'Import cancelled') {
                console.error('Import error:', error);
                alert(i18n.t('import.failed', { error: error.message }));
                this.hideImportProgressModal();
            } else {
                console.log(i18n.t('import.cancelled'));
                this.hideImportProgressModal();
            }
        }
    }

    isAudioFile(filename) {
        const audioExtensions = ['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac'];
        return audioExtensions.some(ext => filename.toLowerCase().endsWith(ext));
    }

    async parseAudioFile(file, filename) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const audio = new Audio();
                audio.src = URL.createObjectURL(file);
                
                audio.addEventListener('loadedmetadata', () => {
                    const song = {
                        id: this.generateId(),
                        title: filename.replace(/\.[^/.]+$/, ''),
                        artist: i18n.t('common.unknownArtist'),
                        album: i18n.t('common.unknownAlbum'),
                        year: '',
                        duration: audio.duration,
                        file: file,
                        fileHandle: file
                    };
                    resolve(song);
                });
                
                audio.addEventListener('error', () => {
                    resolve(null);
                });
            };
            reader.onerror = () => resolve(null);
            reader.readAsArrayBuffer(file);
        });
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    async saveSongsToDB() {
        const transaction = this.db.transaction(['songs'], 'readwrite');
        const store = transaction.objectStore('songs');
        
        for (const song of this.playlist) {
            store.put({
                id: song.id,
                title: song.title,
                artist: song.artist,
                album: song.album,
                year: song.year,
                duration: song.duration
            });
        }
    }

    switchView(view) {
        this.currentView = view;
        this.currentPage = 1;
        this.currentFilter = null;
        this.currentFilterType = null;
        this.searchQuery = '';
        document.getElementById('searchInput').value = '';
        this.updateClearButton();
        
        localStorage.setItem('musicPlayerView', JSON.stringify({ view: view }));
        
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.view === view) {
                item.classList.add('active');
            }
        });
        
        document.querySelectorAll('.nav-submenu-item').forEach(item => {
            item.classList.remove('active');
        });
        
        if (view === 'all' || view === 'favorites') {
            document.querySelectorAll('.nav-item[data-view="artist"], .nav-item[data-view="album"]').forEach(item => {
                item.classList.remove('expanded');
            });
            document.querySelectorAll('.nav-submenu').forEach(submenu => {
                submenu.classList.add('collapsed');
            });
        } else if (view === 'artist' || view === 'album') {
            const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
            if (navItem) {
                navItem.classList.add('expanded');
            }
            const submenu = document.getElementById(`${view}Submenu`);
            if (submenu) {
                submenu.classList.remove('collapsed');
            }
        }
        
        this.filterPlaylist();
        
        if (this.currentTrack) {
            const trackIndex = this.filteredPlaylist.findIndex(song => song.id === this.currentTrack.id);
            if (trackIndex !== -1) {
                this.currentPage = Math.floor(trackIndex / this.pageSize) + 1;
            }
        }

        const titles = {
            'all': i18n.t('contentTitle.allSongs'),
            'artist': i18n.t('contentTitle.artist'),
            'album': i18n.t('contentTitle.album'),
            'favorites': i18n.t('contentTitle.myPlaylist')
        };
        document.getElementById('contentTitle').textContent = `${titles[view]} (${i18n.t('contentTitle.songCount', { count: this.filteredPlaylist.length })})`;
        
        this.restoreLastSongPage();
        this.restoreSelectionState(view);
        this.renderSongList();
    }
    
    saveSelectionState() {
        this.viewSelectionState[this.currentView] = new Set(this.selectedSongs);
    }
    
    restoreSelectionState(view) {
        this.selectedSongs.clear();
        const savedState = this.viewSelectionState[view] || new Set();
        
        this.filteredPlaylist.forEach(song => {
            if (savedState.has(song.id)) {
                this.selectedSongs.add(song.id);
            }
        });
    }

    toggleSubmenu(view) {
        const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
        const submenu = document.getElementById(`${view}Submenu`);
        
        navItem.classList.toggle('expanded');
        submenu.classList.toggle('collapsed');
    }

    filterPlaylist() {
        switch (this.currentView) {
            case 'all':
                this.filteredPlaylist = [...this.playlist];
                break;
            case 'favorites':
                this.filteredPlaylist = this.playlist.filter(song => this.favorites.has(song.id));
                break;
            case 'artist':
                this.filteredPlaylist = [...this.playlist];
                break;
            case 'album':
                this.filteredPlaylist = [...this.playlist];
                break;
            default:
                this.filteredPlaylist = [...this.playlist];
        }
    }
    
    performSearch() {
        this.filterPlaylist();
        
        if (this.currentFilterType && this.currentFilter) {
            if (this.currentFilterType === 'artist') {
                this.filteredPlaylist = this.filteredPlaylist.filter(song => song.artist === this.currentFilter);
            } else if (this.currentFilterType === 'album') {
                this.filteredPlaylist = this.filteredPlaylist.filter(song => song.album === this.currentFilter);
            }
        }
        
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            this.filteredPlaylist = this.filteredPlaylist.filter(song => {
                const titleMatch = song.title && song.title.toLowerCase().includes(query);
                const artistMatch = song.artist && song.artist.toLowerCase().includes(query);
                const albumMatch = song.album && song.album.toLowerCase().includes(query);
                return titleMatch || artistMatch || albumMatch;
            });
        }
        
        this.renderSongList();
        
        const contentTitle = document.getElementById('contentTitle');
        const baseTitle = this.currentFilter 
            ? `${this.currentFilterType === 'artist' ? i18n.t('contentTitle.artist') : i18n.t('contentTitle.album')}: ${this.currentFilter}` 
            : contentTitle.textContent.split('(')[0].trim();
        const countText = this.searchQuery 
            ? `${i18n.t('contentTitle.searchResults')} (${i18n.t('contentTitle.songCount', { count: this.filteredPlaylist.length })})`
            : `${baseTitle} (${i18n.t('contentTitle.songCount', { count: this.filteredPlaylist.length })})`;
        contentTitle.textContent = countText;
    }
    
    updateClearButton() {
        const searchClearBtn = document.getElementById('searchClearBtn');
        if (this.searchQuery) {
            searchClearBtn.style.display = 'flex';
        } else {
            searchClearBtn.style.display = 'none';
        }
    }

    updateContentTitle() {
        const contentTitle = document.getElementById('contentTitle');
        let title;
        
        if (this.searchQuery) {
            title = `${i18n.t('contentTitle.searchResults')} (${i18n.t('contentTitle.songCount', { count: this.filteredPlaylist.length })})`;
        } else if (this.currentFilter && this.currentFilterType) {
            const filterLabel = this.currentFilterType === 'artist' 
                ? i18n.t('contentTitle.artistFilter', { name: this.currentFilter })
                : i18n.t('contentTitle.albumFilter', { name: this.currentFilter });
            title = `${filterLabel} (${i18n.t('contentTitle.songCount', { count: this.filteredPlaylist.length })})`;
        } else {
            const titles = {
                'all': i18n.t('contentTitle.allSongs'),
                'artist': i18n.t('contentTitle.artist'),
                'album': i18n.t('contentTitle.album'),
                'favorites': i18n.t('contentTitle.myPlaylist')
            };
            title = `${titles[this.currentView]} (${i18n.t('contentTitle.songCount', { count: this.filteredPlaylist.length })})`;
        }
        
        contentTitle.textContent = title;
    }

    renderSongList() {
        const tbody = document.getElementById('songListBody');
        const emptyState = document.getElementById('emptyState');
        const paginationContainer = document.getElementById('paginationContainer');
        
        if (this.filteredPlaylist.length === 0) {
            tbody.innerHTML = '';
            emptyState.style.display = 'flex';
            paginationContainer.style.display = 'none';
            return;
        }
        
        emptyState.style.display = 'none';
        paginationContainer.style.display = 'flex';
        
        const totalPages = Math.ceil(this.filteredPlaylist.length / this.pageSize);
        
        if (this.currentPage > totalPages) {
            this.currentPage = totalPages;
        }
        
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        const pageSongs = this.filteredPlaylist.slice(startIndex, endIndex);
        
        const lastPlayedSongId = localStorage.getItem('musicPlayerLastSong');
        
        tbody.innerHTML = pageSongs.map((song, index) => {
            const isCurrentPlaying = this.currentTrack && this.currentTrack.id === song.id;
            const isLastPlayed = !isCurrentPlaying && lastPlayedSongId === song.id;
            const rowClass = (isCurrentPlaying || isLastPlayed) ? 'playing' : '';
            
            return `
            <tr data-id="${song.id}" class="${rowClass}">
                <td class="col-select">
                    <input type="checkbox" class="song-checkbox" data-id="${song.id}">
                </td>
                <td class="song-number">${startIndex + index + 1}</td>
                <td class="song-title">${this.escapeHtml(song.title)}</td>
                <td class="song-artist">${this.escapeHtml(song.artist)}</td>
                <td class="song-album">${this.escapeHtml(song.album)}</td>
                <td class="song-duration">${this.formatTime(song.duration)}</td>
                <td class="col-status">
                    ${isCurrentPlaying && this.isPlaying 
                        ? '<div class="waveform-animation"><span></span><span></span><span></span><span></span><span></span></div>' 
                        : '<button class="status-play-btn" data-id="' + song.id + '">▶</button>'}
                </td>
                <td class="col-actions">
                    <button class="play-row-btn" data-id="${song.id}">▶</button>
                    ${this.currentView === 'favorites' 
                        ? '<button class="delete-from-favorites-btn" data-id="' + song.id + '"><img src="imgs/delete-icon.svg" alt="" width="14" height="14"></button>'
                        : '<button class="favorite-btn ' + (this.favorites.has(song.id) ? 'active' : '') + '" data-id="' + song.id + '"><img src="imgs/' + (this.favorites.has(song.id) ? 'heart-red' : 'heart-white') + '.svg" alt="" width="14" height="14"></button><span class="action-separator"></span><button class="delete-from-library-btn" data-id="' + song.id + '"><img src="imgs/delete-icon.svg" alt="" width="14" height="14"></button>'}
                </td>
            </tr>
        `}).join('');
        
        tbody.querySelectorAll('.play-row-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const songId = e.currentTarget.dataset.id;
                this.playSongById(songId);
            });
        });
        
        tbody.querySelectorAll('.status-play-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const songId = e.currentTarget.dataset.id;
                this.playSongById(songId);
            });
        });
        
        tbody.querySelectorAll('.favorite-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const songId = e.currentTarget.dataset.id;
                this.toggleFavorite(songId);
            });
        });
        
        tbody.querySelectorAll('.delete-from-favorites-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const songId = e.currentTarget.dataset.id;
                this.deleteFromFavorites(songId);
            });
        });
        
        tbody.querySelectorAll('.delete-from-library-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const songId = e.currentTarget.dataset.id;
                this.deleteFromLibrary(songId);
            });
        });
        
        tbody.querySelectorAll('tr').forEach(row => {
            row.addEventListener('dblclick', (e) => {
                if (e.target.closest('.col-actions') || e.target.closest('.col-select') || e.target.closest('.col-status')) {
                    return;
                }
                const songId = row.dataset.id;
                this.playSongById(songId, true);
            });
        });
        
        tbody.querySelectorAll('.song-checkbox').forEach(checkbox => {
            checkbox.checked = this.selectedSongs.has(checkbox.dataset.id);
            
            checkbox.addEventListener('change', (e) => {
                const songId = e.currentTarget.dataset.id;
                if (e.target.checked) {
                    this.selectedSongs.add(songId);
                } else {
                    this.selectedSongs.delete(songId);
                }
                
                this.saveSelectionState();
                this.updateSelectAllCheckbox();
                this.updateActionButtons();
            });
        });
        
        this.updateSelectAllCheckbox();
        this.updateActionButtons();
        
        tbody.querySelectorAll('.song-title, .song-artist, .song-album').forEach(cell => {
            cell.addEventListener('mouseenter', (e) => {
                this.showTooltip(e);
            });
            cell.addEventListener('mouseleave', () => {
                this.hideTooltip();
            });
        });
        
        this.updatePagination(totalPages);
        this.updateScrollbar();
    }

    updateScrollbar() {
        const container = document.querySelector('.song-list-container');
        const table = document.querySelector('.song-list');
        
        if (!container || !table) {
            return;
        }
        
        const containerHeight = container.clientHeight;
        const tableHeight = table.scrollHeight;
        
        if (tableHeight <= containerHeight) {
            container.style.overflowY = 'hidden';
        } else {
            container.style.overflowY = 'auto';
        }
    }

    showTooltip(e) {
        const cell = e.currentTarget;
        const tooltip = document.getElementById('customTooltip');
        
        const range = document.createRange();
        range.selectNodeContents(cell);
        const textWidth = range.getBoundingClientRect().width;
        
        const style = window.getComputedStyle(cell);
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const cellWidth = cell.clientWidth - padding;
        
        if (textWidth <= cellWidth - 2) {
            return;
        }
        
        tooltip.textContent = cell.textContent;
        tooltip.classList.add('show');
        
        const rect = cell.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        
        let top = rect.bottom + 8;
        let left = rect.left + (rect.width - tooltipRect.width) / 2;
        
        if (left < 10) {
            left = 10;
        }
        
        if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10;
        }
        
        if (top + tooltipRect.height > window.innerHeight - 10) {
            top = rect.top - tooltipRect.height - 8;
        }
        
        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    }

    showControlTooltip(e, text) {
        const tooltip = document.getElementById('customTooltip');
        const btn = e.currentTarget;
        tooltip.textContent = text;
        tooltip.dataset.targetBtn = btn.id;
        tooltip.classList.add('show');
        
        const rect = btn.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        
        let top = rect.bottom + 8;
        let left = rect.left + (rect.width - tooltipRect.width) / 2;
        
        if (left < 10) {
            left = 10;
        }
        
        if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10;
        }
        
        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    }

    hideTooltip() {
        const tooltip = document.getElementById('customTooltip');
        tooltip.classList.remove('show');
        delete tooltip.dataset.targetBtn;
    }

    isTextOverflowed(element) {
        const range = document.createRange();
        range.selectNodeContents(element);
        const textWidth = range.getBoundingClientRect().width;
        return textWidth > element.clientWidth + 1;
    }

    updatePagination(totalPages) {
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        const paginationText = document.getElementById('paginationText');
        const paginationTotal = document.getElementById('paginationTotal');
        
        prevBtn.disabled = this.currentPage <= 1;
        nextBtn.disabled = this.currentPage >= totalPages;
        paginationText.textContent = i18n.t('pagination.page', { current: this.currentPage });
        paginationTotal.textContent = i18n.t('pagination.totalPages', { total: totalPages });
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.filteredPlaylist.length / this.pageSize);
        
        if (page < 1 || page > totalPages) {
            return;
        }
        
        this.currentPage = page;
        this.selectedSongs.clear();
        this.renderSongList();
    }

    goToPrevPage() {
        this.goToPage(this.currentPage - 1);
    }

    goToNextPage() {
        this.goToPage(this.currentPage + 1);
    }

    updateUI() {
        this.updateNavigation();
        this.renderSongList();
        this.updatePlayerUI();
    }

    updateNavigation() {
        const artistNavItem = document.querySelector('.nav-item[data-view="artist"]');
        const albumNavItem = document.querySelector('.nav-item[data-view="album"]');
        
        const wasArtistExpanded = artistNavItem && artistNavItem.classList.contains('expanded');
        const wasAlbumExpanded = albumNavItem && albumNavItem.classList.contains('expanded');
        
        const artists = [...new Set(this.playlist.map(song => song.artist).filter(Boolean))].sort();
        const albums = [...new Set(this.playlist.map(song => song.album).filter(Boolean))].sort();
        
        const artistSubmenu = document.getElementById('artistSubmenu');
        const albumSubmenu = document.getElementById('albumSubmenu');
        
        artistSubmenu.innerHTML = `<div>${artists.map(artist => 
            `<div class="nav-submenu-item" data-type="artist" data-value="${artist}">
                <span class="nav-text">${artist}</span>
            </div>`
        ).join('')}</div>`;
        
        albumSubmenu.innerHTML = `<div>${albums.map(album => 
            `<div class="nav-submenu-item" data-type="album" data-value="${album}">
                <span class="nav-text">${album}</span>
            </div>`
        ).join('')}</div>`;
        
        document.querySelectorAll('.nav-submenu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const type = e.currentTarget.dataset.type;
                const value = e.currentTarget.dataset.value;
                this.filterBySubmenu(type, value);
                
                document.querySelectorAll('.nav-submenu-item').forEach(i => i.classList.remove('active'));
                e.currentTarget.classList.add('active');
            });
        });
        
        if (this.currentFilterType && this.currentFilter) {
            const activeItem = document.querySelector(`.nav-submenu-item[data-type="${this.currentFilterType}"][data-value="${this.currentFilter}"]`);
            if (activeItem) {
                activeItem.classList.add('active');
            }
        }
        
        const artistSubmenuElement = document.getElementById('artistSubmenu');
        const albumSubmenuElement = document.getElementById('albumSubmenu');
        
        if (artists.length === 0) {
            if (artistNavItem) {
                artistNavItem.classList.remove('expanded');
            }
            if (artistSubmenuElement) {
                artistSubmenuElement.classList.add('collapsed');
            }
        } else if (wasArtistExpanded) {
            if (artistNavItem) {
                artistNavItem.classList.add('expanded');
            }
            if (artistSubmenuElement) {
                artistSubmenuElement.classList.remove('collapsed');
            }
        }
        
        if (albums.length === 0) {
            if (albumNavItem) {
                albumNavItem.classList.remove('expanded');
            }
            if (albumSubmenuElement) {
                albumSubmenuElement.classList.add('collapsed');
            }
        } else if (wasAlbumExpanded) {
            if (albumNavItem) {
                albumNavItem.classList.add('expanded');
            }
            if (albumSubmenuElement) {
                albumSubmenuElement.classList.remove('collapsed');
            }
        }
    }

    onSongMetadataUpdated(detail) {
        const { songId, metadata, coverUrl } = detail;
        
        const songIndex = this.playlist.findIndex(song => song.id === songId);
        if (songIndex === -1) return;
        
        const song = this.playlist[songIndex];
        if (metadata.title) song.title = metadata.title;
        if (metadata.artist) song.artist = metadata.artist;
        if (metadata.album) song.album = metadata.album;
        if (metadata.year) song.year = metadata.year;
        if (metadata.duration) song.duration = metadata.duration;
        if (metadata.releases) song.releases = metadata.releases;
        if (coverUrl) {
            song.hasCover = true;
            song.coverUrl = coverUrl;
        }
        
        const filteredIndex = this.filteredPlaylist.findIndex(song => song.id === songId);
        if (filteredIndex !== -1) {
            Object.assign(this.filteredPlaylist[filteredIndex], song);
        }
        
        this.updateNavigation();
        this.renderSongList();
        
        if (this.currentTrack && this.currentTrack.id === songId) {
            this.updatePlayerUI();
            
            if (!this.currentTrack.coverId && !this.currentTrack.coverUrl) {
                this.loadAndDisplayCover();
            }
        }
    }

    async onSongCoverUpdated(detail) {
        const { songId, coverId, isCurrentPlaying } = detail;
        
        const songIndex = this.playlist.findIndex(song => song.id === songId);
        if (songIndex === -1) return;
        
        const song = this.playlist[songIndex];
        song.coverId = coverId;
        song.hasCover = true;
        
        const filteredIndex = this.filteredPlaylist.findIndex(song => song.id === songId);
        if (filteredIndex !== -1) {
            this.filteredPlaylist[filteredIndex].coverId = coverId;
            this.filteredPlaylist[filteredIndex].hasCover = true;
        }
        
        this.renderSongList();
        
        if (isCurrentPlaying) {
            const albumCover = document.getElementById('albumCover');
            try {
                const coverData = await fileSystemHandler.getCover(coverId);
                if (coverData) {
                    const blob = new Blob([new Uint8Array(coverData)], { type: 'image/jpeg' });
                    const url = URL.createObjectURL(blob);
                    albumCover.src = url;
                }
            } catch (error) {
                console.error('Failed to update cover UI:', error);
            }
        }
    }

    onSongReleasesUpdated(detail) {
        const { songId, releases } = detail;
        
        const songIndex = this.playlist.findIndex(song => song.id === songId);
        if (songIndex === -1) return;
        
        this.playlist[songIndex].releases = releases;
        
        const filteredIndex = this.filteredPlaylist.findIndex(song => song.id === songId);
        if (filteredIndex !== -1) {
            this.filteredPlaylist[filteredIndex].releases = releases;
        }
    }

    onSongAlbumUpdated(detail) {
        const { songId, album } = detail;
        
        const songIndex = this.playlist.findIndex(song => song.id === songId);
        if (songIndex === -1) return;
        
        this.playlist[songIndex].album = album;
        
        const filteredIndex = this.filteredPlaylist.findIndex(song => song.id === songId);
        if (filteredIndex !== -1) {
            this.filteredPlaylist[filteredIndex].album = album;
        }
        
        if (this.currentTrack && this.currentTrack.id === songId) {
            this.currentTrack.album = album;
            document.getElementById('currentAlbum').textContent = album;
        }
        
        this.updateNavigation();
        this.renderSongList();
    }

    filterBySubmenu(type, value) {
        this.currentView = type;
        this.currentFilterType = type;
        this.currentFilter = value;
        this.currentPage = 1;
        this.searchQuery = '';
        document.getElementById('searchInput').value = '';
        this.updateClearButton();
        
        localStorage.setItem('musicPlayerView', JSON.stringify({ 
            view: type, 
            filter: value 
        }));
        
        const navItem = document.querySelector(`.nav-item[data-view="${type}"]`);
        navItem.classList.add('expanded');
        
        const submenu = document.getElementById(`${type}Submenu`);
        submenu.classList.remove('collapsed');
        
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.view === type) {
                item.classList.add('active');
            }
        });
        
        if (type === 'artist') {
            this.filteredPlaylist = this.playlist.filter(song => song.artist === value);
        } else if (type === 'album') {
            this.filteredPlaylist = this.playlist.filter(song => song.album === value);
        }
        
        document.querySelectorAll('.nav-submenu-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.value === value) {
                item.classList.add('active');
            }
        });
        
        if (this.currentTrack) {
            const trackIndex = this.filteredPlaylist.findIndex(song => song.id === this.currentTrack.id);
            if (trackIndex !== -1) {
                this.currentPage = Math.floor(trackIndex / this.pageSize) + 1;
            }
        }
        document.getElementById('contentTitle').textContent = `${type === 'artist' ? i18n.t('contentTitle.artist') : i18n.t('contentTitle.album')}: ${value} (${i18n.t('contentTitle.songCount', { count: this.filteredPlaylist.length })})`;
        
        this.renderSongList();
    }

    async updatePlayerUI() {
        if (this.currentTrack) {
            document.getElementById('currentTitle').textContent = this.currentTrack.title;
            document.getElementById('currentArtist').textContent = this.currentTrack.artist;
            document.getElementById('currentAlbum').textContent = this.currentTrack.album;
            document.getElementById('totalTime').textContent = this.formatTime(this.currentTrack.duration);
            
            const albumCover = document.getElementById('albumCover');
            const defaultCover = "imgs/music-icon.svg";
            
            if (this.currentTrack.coverUrl) {
                albumCover.src = this.currentTrack.coverUrl;
            } else if (this.currentTrack.coverId) {
                try {
                    const coverData = await fileSystemHandler.getCover(this.currentTrack.coverId);
                    if (coverData) {
                        const blob = new Blob([new Uint8Array(coverData)], { type: 'image/jpeg' });
                        const url = URL.createObjectURL(blob);
                        albumCover.src = url;
                    } else {
                        albumCover.src = defaultCover;
                    }
                } catch (error) {
                    console.error('Failed to load cover:', error);
                    albumCover.src = defaultCover;
                }
            } else {
                albumCover.src = defaultCover;
            }
        } else {
            document.getElementById('currentTitle').textContent = i18n.t('player.notPlaying');
            document.getElementById('currentArtist').textContent = i18n.t('player.unknown');
            document.getElementById('currentAlbum').textContent = i18n.t('player.unknown');
            document.getElementById('totalTime').textContent = '0:00';
            
            const albumCover = document.getElementById('albumCover');
            albumCover.src = "imgs/music-icon.svg";
        }
        
        const playBtn = document.getElementById('playBtn');
        const playIconSvg = playBtn.querySelector('.icon-svg');
        const tooltip = document.getElementById('customTooltip');
        if (this.isPlaying) {
            playIconSvg.innerHTML = `<path d="M191.397656 128.194684l191.080943 0 0 768.472256-191.080943 0 0-768.472256Z" fill="currentColor"></path><path d="M575.874261 128.194684l192.901405 0 0 768.472256-192.901405 0 0-768.472256Z" fill="currentColor"></path>`;
            playBtn.dataset.title = i18n.t('player.pause');
            if (tooltip.classList.contains('show') && tooltip.dataset.targetBtn === 'playBtn') {
                tooltip.textContent = i18n.t('player.pause');
            }
        } else {
            playIconSvg.innerHTML = `<path d="M780.8 475.733333L285.866667 168.533333c-27.733333-17.066667-64 4.266667-64 36.266667v614.4c0 32 36.266667 53.333333 64 36.266667l492.8-307.2c29.866667-14.933333 29.866667-57.6 2.133333-72.533334z" fill="currentColor"></path>`;
            playBtn.dataset.title = i18n.t('player.play');
            if (tooltip.classList.contains('show') && tooltip.dataset.targetBtn === 'playBtn') {
                tooltip.textContent = i18n.t('player.play');
            }
        }
        
        this.updatePlayModeUI();
    }

    async loadAndDisplayCover() {
        if (!this.currentTrack) return;
        
        if (this.currentTrack.coverUrl) {
            return;
        }
        
        if (this.currentTrack.coverId) {
            return;
        }
        
        try {
            const coverInfo = await fileSystemHandler.findCoverByArtistAlbum(
                this.currentTrack.artist,
                this.currentTrack.album
            );
            
            if (coverInfo) {
                this.currentTrack.coverId = coverInfo.id;
                this.currentTrack.hasCover = true;
                
                await fileSystemHandler.updateSongCoverId(this.currentTrack.id, coverInfo.id);
                
                const albumCover = document.getElementById('albumCover');
                const blob = new Blob([new Uint8Array(coverInfo.data)], { type: 'image/jpeg' });
                const url = URL.createObjectURL(blob);
                albumCover.src = url;
                return;
            }
        } catch (error) {
            console.error('Failed to find cover:', error);
        }
        
        if (this.currentTrack.artist && 
            this.currentTrack.artist !== i18n.t('common.unknownArtist') &&
            this.currentTrack.album && 
            this.currentTrack.album !== i18n.t('common.unknownAlbum')) {
            
            if (this.currentTrack.releases && this.currentTrack.releases.length > 0) {
                fileSystemHandler.enqueueCoverFetch(
                    this.currentTrack.id,
                    this.currentTrack.artist,
                    this.currentTrack.album,
                    this.currentTrack.releases
                );
            } else {
                fileSystemHandler.enqueueCoverFetchWithQuery(
                    this.currentTrack.id,
                    this.currentTrack.title,
                    this.currentTrack.artist,
                    this.currentTrack.album
                );
            }
        }
    }

    parseLRC(lrcString) {
        if (!lrcString) return [];
        
        const lines = lrcString.split('\n');
        const result = [];
        const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
        
        for (const line of lines) {
            const matches = [...line.matchAll(timeRegex)];
            const text = line.replace(timeRegex, '').trim();
            
            if (!text) continue;
            
            for (const match of matches) {
                const minutes = parseInt(match[1], 10);
                const seconds = parseInt(match[2], 10);
                const milliseconds = parseInt(match[3].padEnd(3, '0'), 10);
                const time = minutes * 60 + seconds + milliseconds / 1000;
                
                result.push({ time, text });
            }
        }
        
        return result.sort((a, b) => a.time - b.time);
    }

    renderLyrics() {
        const lyricsContent = document.getElementById('lyricsContent');
        if (!lyricsContent) return;
        
        if (this.parsedLyrics.length === 0) {
            lyricsContent.innerHTML = `<div class="lyrics-placeholder">${i18n.t('player.noLyrics')}</div>`;
            return;
        }
        
        const html = this.parsedLyrics.map((line, index) => 
            `<div class="lyrics-line" data-index="${index}">${line.text}</div>`
        ).join('');
        
        lyricsContent.innerHTML = html;
    }

    updateLyricsDisplay() {
        if (!this.currentTrack) {
            const lyricsContent = document.getElementById('lyricsContent');
            if (lyricsContent) {
                lyricsContent.innerHTML = `<div class="lyrics-placeholder">${i18n.t('player.noLyrics')}</div>`;
            }
            return;
        }
        this.renderLyrics();
    }

    updateLyricsHighlight() {
        if (this.parsedLyrics.length === 0) return;
        
        const currentTime = this.audioElement.currentTime;
        let newIndex = -1;
        
        for (let i = this.parsedLyrics.length - 1; i >= 0; i--) {
            if (currentTime >= this.parsedLyrics[i].time) {
                newIndex = i;
                break;
            }
        }
        
        if (newIndex !== this.currentLyricIndex) {
            this.currentLyricIndex = newIndex;
            
            const lyricsContent = document.getElementById('lyricsContent');
            if (!lyricsContent) return;
            
            const lines = lyricsContent.querySelectorAll('.lyrics-line');
            lines.forEach((line, index) => {
                if (index === newIndex) {
                    line.classList.add('active');
                } else {
                    line.classList.remove('active');
                }
            });
            
            if (newIndex >= 0) {
                const activeLine = lines[newIndex];
                if (activeLine) {
                    activeLine.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                        inline: 'nearest'
                    });
                }
            }
        }
    }

    async processLyricsQueue() {
        if (this.isProcessingLyricsQueue) return;
        
        this.isProcessingLyricsQueue = true;
        
        while (this.lyricsQueue.length > 0) {
            const task = this.lyricsQueue.pop();
            
            try {
                const lyrics = await fileSystemHandler.fetchLyrics(
                    task.artist,
                    task.title,
                    task.album,
                    task.duration
                );
                
                if (lyrics && lyrics.syncedLyrics) {
                    console.log(`\n===== Lyrics fetched successfully (${task.title}) =====`);
                    
                    const convertedLyrics = fileSystemHandler.convertByBrowserLocale(lyrics.syncedLyrics);
                    
                    await fileSystemHandler.updateSongLyrics(task.trackId, convertedLyrics);
                    console.log(`Lyrics saved to database: ${task.title}`);
                    
                    if (this.currentTrack && this.currentTrack.id === task.trackId) {
                        this.currentTrack.lyrics = convertedLyrics;
                        this.parsedLyrics = this.parseLRC(convertedLyrics);
                        this.renderLyrics();
                        console.log(`Lyrics displayed: ${task.title}`);
                    }
                } else {
                    if (this.currentTrack && this.currentTrack.id === task.trackId) {
                        this.renderLyrics();
                    }
                }
            } catch (error) {
                console.error(`Failed to fetch lyrics (${task.title}):`, error);
                if (this.currentTrack && this.currentTrack.id === task.trackId) {
                    this.renderLyrics();
                }
            }
            
            if (this.lyricsQueue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        this.isProcessingLyricsQueue = false;
    }

    async loadAndDisplayLyrics() {
        const lyricsContent = document.getElementById('lyricsContent');
        if (lyricsContent) {
            lyricsContent.innerHTML = `<div class="lyrics-placeholder">${i18n.t('player.loadingLyrics')}</div>`;
            lyricsContent.scrollTop = 0;
        }
        
        this.parsedLyrics = [];
        this.currentLyricIndex = -1;
        
        if (!this.currentTrack) return;
        
        if (!this.currentTrack.artist || this.currentTrack.artist === i18n.t('common.unknownArtist')) {
            console.log('Skip lyrics fetch: unknown artist');
            this.renderLyrics();
            return;
        }
        
        if (!this.currentTrack.title) {
            console.log('Skip lyrics fetch: no song title');
            this.renderLyrics();
            return;
        }
        
        if (this.currentTrack.lyrics) {
            console.log('\n===== Lyrics content (cached) =====');
            console.log('\nSynced lyrics (LRC format):');
            console.log(this.currentTrack.lyrics);
            console.log('====================\n');
            
            this.parsedLyrics = this.parseLRC(this.currentTrack.lyrics);
            this.renderLyrics();
            return;
        }
        
        const dbLyrics = await fileSystemHandler.getSongLyrics(this.currentTrack.id);
        if (dbLyrics) {
            console.log('\n===== Lyrics content (database) =====');
            this.currentTrack.lyrics = dbLyrics;
            this.parsedLyrics = this.parseLRC(dbLyrics);
            this.renderLyrics();
            return;
        }
        
        this.lyricsQueue.push({
            trackId: this.currentTrack.id,
            artist: this.currentTrack.artist,
            title: this.currentTrack.title,
            album: this.currentTrack.album,
            duration: this.currentTrack.duration
        });
        
        this.processLyricsQueue();
    }

    updatePlayModeUI() {
        const playModeBtn = document.getElementById('playModeBtn');
        const playModeIconSvg = playModeBtn.querySelector('.icon-svg');
        const tooltip = document.getElementById('customTooltip');
        
        const titles = {
            'shuffle': i18n.t('player.shuffle'),
            'repeat': i18n.t('player.repeat'),
            'one': i18n.t('player.repeatOne')
        };
        playModeBtn.dataset.title = titles[this.playMode];
        
        if (tooltip.classList.contains('show') && tooltip.dataset.targetBtn === 'playModeBtn') {
            tooltip.textContent = titles[this.playMode];
        }
        
        if (this.playMode === 'shuffle') {
            playModeIconSvg.innerHTML = `<path d="M753.564731 337.471035c-45.8697 0-160.259984 113.849978-243.789399 194.548928C383.134027 654.383848 263.508509 773.284865 167.764911 773.284865l-58.892295 0c-24.068162 0-43.581588-19.526729-43.581588-43.581588s19.513426-43.581588 43.581588-43.581588l58.892295 0c60.504002 0 183.002964-121.68134 281.432741-216.784348 119.79641-115.744117 223.254713-219.029482 304.368102-219.029482l56.209186 0-59.641355-57.828057c-17.033955-16.993023-17.060561-42.902112-0.057305-59.927881 17.002232-17.030885 44.596707-17.064654 61.631686-0.065492l134.207631 133.874033c8.192589 8.172123 12.794397 19.238157 12.794397 30.803563 0 11.564383-4.601808 22.604834-12.794397 30.776957L811.706943 461.72599c-8.505721 8.486278-19.646456 12.522198-30.78719 12.522198-11.166317 0-22.333658-4.676509-30.844495-13.199627-17.003256-17.025769-16.975627-45.432749 0.057305-62.425771l59.641355-61.151755L753.564731 337.471035zM811.706943 561.66105c-17.034978-16.999163-44.629453-16.972557-61.631686 0.058328-17.003256 17.024745-16.975627 46.257533 0.057305 63.250556l59.641355 61.150732-56.209186 0c-35.793204 0-95.590102-52.946886-154.87637-108.373243-17.576307-16.435321-45.161572-16.3422-61.594847 1.226944-16.444531 17.568121-15.523555 46.393633 2.053776 62.823837 90.322122 84.458577 151.246703 131.484613 214.417441 131.484613l56.209186 0-59.641355 57.824987c-17.033955 16.993023-17.060561 43.736107-0.057305 60.761875 8.511861 8.523117 19.678178 12.369725 30.844495 12.369725 11.140735 0 22.281469-4.453429 30.78719-12.939707L945.914574 757.311055c8.192589-8.173147 12.794397-19.315928 12.794397-30.881334 0-11.564383-4.601808-22.682605-12.794397-30.855752L811.706943 561.66105zM108.871593 337.471035l58.892295 0c45.932122 0 114.40154 58.455343 168.915108 107.942431 8.352225 7.576559 18.832927 12.140505 29.29214 12.140505 11.852956 0 23.673166-4.394077 32.270984-13.857613 16.182564-17.807574 14.859429-46.823422-2.958378-62.998823-85.247546-77.381391-156.561755-130.388652-227.519854-130.388652l-58.892295 0c-24.068162 0-43.581588 19.526729-43.581588 43.581588S84.804455 337.471035 108.871593 337.471035z" fill="currentColor"></path>`;
        } else if (this.playMode === 'repeat') {
            playModeIconSvg.innerHTML = `<path d="M301.392 805.072v53.856a20 20 0 0 1-33.056 15.104l-117.76-101.84a20 20 0 0 1 0-30.24l117.76-101.84a20 20 0 0 1 33.056 15.12v53.84h332.288c89.344 0 161.856-72.8 161.856-162.72v-9.6a48 48 0 1 1 96 0v9.6c0 142.832-115.408 258.72-257.856 258.72H301.392z m437.216-570.144v-53.856a20 20 0 0 1 33.056-15.104l117.76 101.84a20 20 0 0 1 0 30.24l-117.76 101.84a20 20 0 0 1-33.056-15.12v-53.84H406.32c-89.344 0-161.856 72.8-161.856 162.72v9.6a48 48 0 0 1-96 0v-9.6c0-142.832 115.408-258.72 257.856-258.72h332.288z" fill="currentColor"></path>`;
        } else if (this.playMode === 'one') {
            playModeIconSvg.innerHTML = `<path d="M563.717 408.566v310.303H512V512h-51.717v-51.717H512v-51.717h51.717z m206.869-51.718H356.848a206.869 206.869 0 0 0 0 413.738h310.304A206.869 206.869 0 0 0 874.02 563.717V512h98.263a340.247 340.247 0 0 1 5.172 51.717A310.303 310.303 0 0 1 667.152 874.02H356.848a310.303 310.303 0 0 1 0-620.606h413.738V149.98L977.455 305.13l-206.87 155.152V356.848z" fill="currentColor"></path>`;
        }
    }

    playAll() {
        if (this.filteredPlaylist.length === 0) return;
        
        if (this.playMode === 'one') {
            this.playMode = 'repeat';
            this.updatePlayModeUI();
        }
        
        this.currentIndex = 0;
        const firstSong = this.filteredPlaylist[0];
        
        if (this.currentTrack && this.currentTrack.id === firstSong.id) {
            this.audioElement.currentTime = 0;
            if (!this.isPlaying) {
                this.audioElement.play();
                this.isPlaying = true;
                this.updateUI();
            }
        } else {
            this.playSong(firstSong);
        }
    }

    async playSong(song) {
        if (this.currentTrack && this.currentTrack.id === song.id) {
            this.togglePlay();
            return;
        }
        
        this.currentTrack = song;
        
        const songIndex = this.filteredPlaylist.findIndex(s => s.id === song.id);
        if (songIndex !== -1) {
            this.currentIndex = songIndex;
            const targetPage = Math.floor(songIndex / this.pageSize) + 1;
            if (targetPage !== this.currentPage) {
                this.currentPage = targetPage;
            }
        }
        
        try {
            let file = song.file;
            if (!file && song.handle) {
                try {
                    const permission = await song.handle.queryPermission({ mode: 'read' });
                    if (permission !== 'granted') {
                        const requestPermission = await song.handle.requestPermission({ mode: 'read' });
                        if (requestPermission !== 'granted') {
                            throw new Error(i18n.t('errors.permissionRequired'));
                        }
                    }
                    file = await song.handle.getFile();
                    song.file = file;
                } catch (permError) {
                    console.error('File access permission error:', permError);
                    this.showPermissionError(song);
                    return;
                }
            }
            
            if (!file) {
                console.error('Cannot get file:', song.title);
                return;
            }
            
            this.audioElement.src = URL.createObjectURL(file);
            this.audioElement.load();
            await this.audioElement.play();
            this.isPlaying = true;
            
            localStorage.setItem('musicPlayerLastSong', song.id);
            
            this.updateUI();
            this.loadAndDisplayCover();
            this.loadAndDisplayLyrics();
        } catch (error) {
            console.error('Playback failed:', error);
            this.isPlaying = false;
            this.updateUI();
        }
    }

    showPermissionError(song) {
        const notification = document.createElement('div');
        notification.className = 'permission-notification';
        notification.innerHTML = `
            <div class="permission-content">
                <p>${i18n.t('errors.playFailedTitle', { title: song.title })}</p>
                <p>${i18n.t('errors.playFailedRefresh')}</p>
                <p>${i18n.t('errors.playFailedAction')}</p>
                <button class="authorize-btn">${i18n.t('errors.authorize')}</button>
                <button class="close-notification-btn">${i18n.t('errors.close')}</button>
            </div>
        `;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #2a2a2a;
            border: 1px solid #444;
            border-radius: 8px;
            padding: 16px 24px;
            z-index: 10000;
            color: #fff;
            text-align: center;
        `;
        
        const authorizeBtn = notification.querySelector('.authorize-btn');
        authorizeBtn.style.cssText = `
            background: #1db954;
            border: none;
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin: 8px;
        `;
        
        const closeBtn = notification.querySelector('.close-notification-btn');
        closeBtn.style.cssText = `
            background: #555;
            border: none;
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin: 8px;
        `;
        
        authorizeBtn.addEventListener('click', async () => {
            try {
                const permission = await song.handle.requestPermission({ mode: 'read' });
                if (permission === 'granted') {
                    notification.remove();
                    this.playSong(song);
                }
            } catch (e) {
                console.error('Authorization failed:', e);
            }
        });
        
        closeBtn.addEventListener('click', () => {
            notification.remove();
        });
        
        document.body.appendChild(notification);
    }

    playSongById(songId, restart = false) {
        const song = this.playlist.find(s => s.id === songId);
        if (song) {
            if (restart && this.currentTrack && this.currentTrack.id === songId && this.isPlaying) {
                this.audioElement.currentTime = 0;
            } else {
                this.playSong(song);
            }
        }
    }

    togglePlay() {
        if (!this.currentTrack) {
            if (this.filteredPlaylist.length > 0) {
                this.playAll();
            }
            return;
        }
        
        if (this.isPlaying) {
            this.audioElement.pause();
            this.isPlaying = false;
        } else {
            this.audioElement.play();
            this.isPlaying = true;
        }
        
        this.updateUI();
    }

    playPrevious() {
        if (this.filteredPlaylist.length === 0) return;
        
        if (this.audioElement.currentTime > 3) {
            this.audioElement.currentTime = 0;
            return;
        }
        
        this.currentIndex = (this.currentIndex - 1 + this.filteredPlaylist.length) % this.filteredPlaylist.length;
        this.playSong(this.filteredPlaylist[this.currentIndex]);
    }

    playNext() {
        if (this.filteredPlaylist.length === 0) return;
        
        if (this.playMode === 'shuffle') {
            this.currentIndex = Math.floor(Math.random() * this.filteredPlaylist.length);
        } else {
            this.currentIndex = (this.currentIndex + 1) % this.filteredPlaylist.length;
        }
        
        this.playSong(this.filteredPlaylist[this.currentIndex]);
    }

    onTrackEnd() {
        if (this.playMode === 'one') {
            this.audioElement.currentTime = 0;
            this.audioElement.play();
        } else if (this.playMode === 'repeat' || this.currentIndex < this.filteredPlaylist.length - 1) {
            this.playNext();
        } else {
            this.isPlaying = false;
            this.updateUI();
        }
    }

    togglePlayMode() {
        const modes = ['repeat', 'shuffle', 'one'];
        const currentIndex = modes.indexOf(this.playMode);
        this.playMode = modes[(currentIndex + 1) % modes.length];
        this.updateUI();
    }

    setVolume(value) {
        this.volume = value / 100;
        this.audioElement.volume = this.volume;
        
        localStorage.setItem('musicPlayerVolume', this.volume);
        
        const volumeFill = document.getElementById('volumeFill');
        const volumeThumb = document.getElementById('volumeThumb');
        volumeFill.style.width = `${value}%`;
        volumeThumb.style.left = `${value}%`;
        
        this.updateVolumeIcon();
    }

    updateVolumeIcon() {
        const volumeBtn = document.getElementById('volumeBtn');
        const svg = volumeBtn.querySelector('.icon-svg');
        
        if (this.volume <= 0.01) {
            svg.innerHTML = `
                <path d="M260.256 356.576l204.288-163.968a32 32 0 0 1 52.032 24.96v610.432a32 32 0 0 1-51.968 24.992l-209.92-167.552H96a32 32 0 0 1-32-32v-264.864a32 32 0 0 1 32-32h164.256z" fill="currentColor"></path>
                <path d="M700 340l280 280M980 340l-280 280" stroke="currentColor" stroke-width="80" stroke-linecap="round" fill="none"></path>
            `;
        } else if (this.volume < 0.5) {
            svg.innerHTML = `
                <path d="M260.256 356.576l204.288-163.968a32 32 0 0 1 52.032 24.96v610.432a32 32 0 0 1-51.968 24.992l-209.92-167.552H96a32 32 0 0 1-32-32v-264.864a32 32 0 0 1 32-32h164.256z" fill="currentColor"></path>
                <path class="wave-1" d="M670.784 720.128a32 32 0 0 1-44.832-45.664 214.08 214.08 0 0 0 64.32-153.312 213.92 213.92 0 0 0-55.776-144.448 32 32 0 1 1 47.36-43.04 277.92 277.92 0 0 1 72.416 187.488 278.08 278.08 0 0 1-83.488 198.976z" fill="currentColor"></path>
            `;
        } else {
            svg.innerHTML = `
                <path d="M260.256 356.576l204.288-163.968a32 32 0 0 1 52.032 24.96v610.432a32 32 0 0 1-51.968 24.992l-209.92-167.552H96a32 32 0 0 1-32-32v-264.864a32 32 0 0 1 32-32h164.256z" fill="currentColor"></path>
                <path class="wave-1" d="M670.784 720.128a32 32 0 0 1-44.832-45.664 214.08 214.08 0 0 0 64.32-153.312 213.92 213.92 0 0 0-55.776-144.448 32 32 0 1 1 47.36-43.04 277.92 277.92 0 0 1 72.416 187.488 278.08 278.08 0 0 1-83.488 198.976z" fill="currentColor"></path>
                <path class="wave-2" d="M822.912 858.88a32 32 0 1 1-45.888-44.608A419.008 419.008 0 0 0 896 521.152c0-108.704-41.376-210.848-114.432-288.384a32 32 0 0 1 46.592-43.872c84.16 89.28 131.84 207.04 131.84 332.256 0 127.84-49.76 247.904-137.088 337.728z" fill="currentColor"></path>
            `;
        }
    }

    toggleMute() {
        const volumeFill = document.getElementById('volumeFill');
        const volumeThumb = document.getElementById('volumeThumb');
        
        if (this.audioElement.volume > 0) {
            this.previousVolume = this.audioElement.volume;
            this.audioElement.volume = 0;
            this.volume = 0;
            volumeFill.style.width = '0%';
            volumeThumb.style.left = '0%';
            this.updateVolumeIcon();
        } else {
            const restoreVolume = this.previousVolume || 0.8;
            this.audioElement.volume = restoreVolume;
            this.volume = restoreVolume;
            volumeFill.style.width = `${restoreVolume * 100}%`;
            volumeThumb.style.left = `${restoreVolume * 100}%`;
            this.updateVolumeIcon();
        }
    }

    updateProgress() {
        if (this.isDraggingProgress) return;
        
        const currentTime = this.audioElement.currentTime;
        const duration = this.audioElement.duration || 1;
        const progress = (currentTime / duration) * 100;
        
        document.getElementById('progressFill').style.width = `${progress}%`;
        document.getElementById('progressThumb').style.left = `${progress}%`;
        document.getElementById('currentTime').textContent = this.formatTime(currentTime);
        
        this.updateLyricsHighlight();
    }

    seekTo(e) {
        const progressBar = e.currentTarget;
        const rect = progressBar.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / rect.width;
        this.audioElement.currentTime = percentage * this.audioElement.duration;
    }

    updateTrackInfo() {
        if (this.currentTrack && this.audioElement.duration) {
            document.getElementById('totalTime').textContent = this.formatTime(this.audioElement.duration);
        }
    }

    toggleFavorite(songId) {
        if (this.favorites.has(songId)) {
            this.favorites.delete(songId);
        } else {
            this.favorites.add(songId);
        }
        
        this.saveFavorites();
        this.renderSongList();
    }

    async saveFavorites() {
        const transaction = this.db.transaction(['favorites'], 'readwrite');
        const store = transaction.objectStore('favorites');
        store.clear();
        
        this.favorites.forEach(id => {
            store.put({ id });
        });
    }

    async loadFavorites() {
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['favorites'], 'readonly');
            const store = transaction.objectStore('favorites');
            const request = store.getAll();
            
            request.onsuccess = () => {
                request.result.forEach(item => {
                    this.favorites.add(item.id);
                });
                resolve();
            };
            
            request.onerror = () => resolve();
        });
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.musicPlayer = new MusicPlayer();
});