class FileSystemHandler {
    constructor() {
        this.audioExtensions = ['.mp3', '.flac'];
        this.db = null;
        this.dbReady = null;
        this.cancelImport = false;
        this.coverQueue = Promise.resolve();
        this.initMusicMetadata();
        this.dbReady = this.initDB();
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('MusicT', 4);
            
            request.onerror = () => {
                console.error('IndexedDB open failed:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            this.db = request.result;
            
            this.db.onclose = () => {
                console.log('IndexedDB connection closed');
                this.db = null;
                this.dbReady = null;
            };
            
            this.db.onversionchange = () => {
                this.db.close();
                console.log('IndexedDB version changed, closing connection');
            };
            
            console.log('IndexedDB initialized successfully');
            resolve();
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const oldVersion = event.oldVersion;
            
            if (!db.objectStoreNames.contains('songs')) {
                const store = db.createObjectStore('songs', { keyPath: 'id' });
                store.createIndex('name', 'name', { unique: false });
                store.createIndex('importTime', 'importTime', { unique: false });
                store.createIndex('deleted', 'deleted', { unique: false });
                store.createIndex('coverId', 'coverId', { unique: false });
                console.log('IndexedDB songs object store created');
            } else {
                const store = event.target.transaction.objectStore('songs');
                
                if (oldVersion < 2) {
                    if (!store.indexNames.contains('deleted')) {
                        store.createIndex('deleted', 'deleted', { unique: false });
                        console.log('IndexedDB added deleted index');
                    }
                }
                
                if (oldVersion < 3) {
                    if (!store.indexNames.contains('coverId')) {
                        store.createIndex('coverId', 'coverId', { unique: false });
                        console.log('IndexedDB added coverId index');
                    }
                }
            }
            
            if (!db.objectStoreNames.contains('covers')) {
                const coverStore = db.createObjectStore('covers', { keyPath: 'id' });
                coverStore.createIndex('artistAlbum', ['artist', 'album'], { unique: false });
                console.log('IndexedDB covers object store created');
            } else {
                const coverStore = event.target.transaction.objectStore('covers');
                
                if (!coverStore.indexNames.contains('artistAlbum')) {
                    coverStore.createIndex('artistAlbum', ['artist', 'album'], { unique: false });
                    console.log('IndexedDB covers added artistAlbum index');
                }
            }
        };
        });
    }

    async ensureDB() {
        if (!this.db || this.db.closed) {
            if (this.dbReady) {
                await this.dbReady;
            }
            if (!this.db || this.db.closed) {
                this.dbReady = this.initDB();
                await this.dbReady;
            }
        }
    }

    async calculateCRC32(file) {
        try {
            const fileSize = file.size;
            const chunkSize = Math.ceil(fileSize * 0.1);
            
            const startChunk = file.slice(0, chunkSize);
            const endChunk = file.slice(fileSize - chunkSize, fileSize);
            
            const startBuffer = await startChunk.arrayBuffer();
            const endBuffer = await endChunk.arrayBuffer();
            
            const startUint8 = new Uint8Array(startBuffer);
            const endUint8 = new Uint8Array(endBuffer);
            
            const combined = new Uint8Array(startUint8.length + endUint8.length);
            combined.set(startUint8, 0);
            combined.set(endUint8, startUint8.length);
            
            const crc32 = CRC32.buf(combined);
            return crc32.toString(16);
        } catch (error) {
            console.error('CRC32 calculation failed:', error);
            return Date.now().toString(36) + Math.random().toString(36).substr(2);
        }
    }
    
    async calculateCoverCRC32(pictureData) {
        try {
            const bytes = new Uint8Array(pictureData);
            const crc32 = CRC32.buf(bytes);
            return crc32.toString(16);
        } catch (error) {
            console.error('Cover CRC32 calculation failed:', error);
            return Date.now().toString(36) + Math.random().toString(36).substr(2);
        }
    }
    
    async saveCoverToDB(coverData, coverId, artist = null, album = null) {
        await this.ensureDB();
        
        const convertedArtist = artist ? this.convertByBrowserLocale(artist) : null;
        const convertedAlbum = album ? this.convertByBrowserLocale(album) : null;
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['covers'], 'readwrite');
            const store = transaction.objectStore('covers');
            
            const getRequest = store.get(coverId);
            
            getRequest.onsuccess = () => {
                const existingCover = getRequest.result;
                
                if (existingCover) {
                    console.log(`Cover already exists, skipping save: ${coverId}`);
                    resolve({ success: true, duplicate: true, id: coverId });
                } else {
                    const coverRecord = {
                        id: coverId,
                        data: coverData,
                        artist: convertedArtist,
                        album: convertedAlbum,
                        timestamp: Date.now()
                    };
                    
                    const addRequest = store.add(coverRecord);
                    
                    addRequest.onsuccess = () => {
                        console.log(`Cover saved successfully: ${coverId}`);
                        resolve({ success: true, duplicate: false, id: coverId });
                    };
                    
                    addRequest.onerror = () => {
                        console.error(`Failed to save cover: ${coverId}`, addRequest.error);
                        reject(addRequest.error);
                    };
                }
            };
            
            getRequest.onerror = () => {
                console.error('Failed to query cover:', getRequest.error);
                reject(getRequest.error);
            };
        });
    }

    async saveToDB(parsedInfo) {
        await this.ensureDB();

        const crc32 = await this.calculateCRC32(parsedInfo.file);
        
        let coverId = null;
        if (parsedInfo.coverData) {
            coverId = await this.calculateCoverCRC32(parsedInfo.coverData);
            await this.saveCoverToDB(
                parsedInfo.coverData, 
                coverId, 
                parsedInfo.artist, 
                parsedInfo.album
            );
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['songs'], 'readwrite');
            const store = transaction.objectStore('songs');
            
            const getRequest = store.get(crc32);
            
            getRequest.onsuccess = () => {
                const existingRecord = getRequest.result;
                
                if (existingRecord) {
                    if (existingRecord.deleted) {
                        console.log(`Restoring deleted record: ${parsedInfo.title} (ID: ${crc32})`);
                        
                        const updatedData = {
                            ...existingRecord,
                            deleted: false,
                            handle: parsedInfo.handle,
                            coverId: coverId || existingRecord.coverId,
                            importTime: Date.now()
                        };
                        
                        const putRequest = store.put(updatedData);
                        
                        putRequest.onsuccess = () => {
                            console.log(`Restore successful: ${parsedInfo.title}`);
                            parsedInfo.id = crc32;
                            resolve({ success: true, duplicate: false, restored: true, id: crc32 });
                        };
                        
                        putRequest.onerror = () => {
                            console.error(`Failed to restore record: ${parsedInfo.title}`, putRequest.error);
                            reject(putRequest.error);
                        };
                    } else {
                        console.log(`Skipping duplicate file: ${parsedInfo.title}`);
                        resolve({ success: false, duplicate: true });
                    }
                } else {
                    const songData = {
                        id: crc32,
                        name: parsedInfo.file.name,
                        path: parsedInfo.path || parsedInfo.file.name,
                        handle: parsedInfo.handle,
                        coverId: coverId,
                        metadata: {
                            title: parsedInfo.title,
                            artist: parsedInfo.artist,
                            album: parsedInfo.album,
                            year: parsedInfo.year,
                            duration: parsedInfo.duration,
                            hasCover: !!coverId
                        },
                        importTime: Date.now(),
                        deleted: false
                    };
                    
                    const addRequest = store.add(songData);
                    
                    addRequest.onsuccess = () => {
                        console.log(`Saved to database: ${parsedInfo.title} (ID: ${crc32})`);
                        parsedInfo.id = crc32;
                        resolve({ success: true, duplicate: false, restored: false, id: crc32 });
                    };
                    
                    addRequest.onerror = () => {
                        console.error(`Failed to save to database: ${parsedInfo.title}`, addRequest.error);
                        reject(addRequest.error);
                    };
                }
            };
            
            getRequest.onerror = () => {
                console.error('Database query failed:', getRequest.error);
                reject(getRequest.error);
            };
        });
    }

    async saveBatchToDB(parsedFiles) {
        let newCount = 0;
        let duplicateCount = 0;
        
        for (const parsedInfo of parsedFiles) {
            try {
                const result = await this.saveToDB(parsedInfo);
                if (result.success) {
                    newCount++;
                } else if (result.duplicate) {
                    duplicateCount++;
                }
            } catch (error) {
                console.error(`Failed to save file: ${parsedInfo.title}`, error);
            }
        }
        
        console.log(`Saved ${newCount} new songs, skipped ${duplicateCount} duplicates`);
        
        return { newCount, duplicateCount };
    }

    async loadAllSongs() {
        await this.ensureDB();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['songs'], 'readonly');
            const store = transaction.objectStore('songs');
            const index = store.index('importTime');
            const request = index.openCursor(null, 'prev');
            
            const songs = [];
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    if (!cursor.value.deleted) {
                        songs.push(cursor.value);
                    }
                    cursor.continue();
                } else {
                    console.log(`Loaded ${songs.length} songs from database (sorted by import time, descending)`);
                    resolve(songs);
                }
            };
            
            request.onerror = () => {
                console.error('Failed to read database:', request.error);
                reject(request.error);
            };
        });
    }
    
    async getCover(coverId) {
        await this.ensureDB();
        
        if (!coverId) {
            return null;
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['covers'], 'readonly');
            const store = transaction.objectStore('covers');
            const request = store.get(coverId);
            
            request.onsuccess = () => {
                const cover = request.result;
                if (cover) {
                    resolve(cover.data);
                } else {
                    resolve(null);
                }
            };
            
            request.onerror = () => {
                console.error('Failed to read cover:', request.error);
                reject(request.error);
            };
        });
    }

    async findCoverByArtistAlbum(artist, album) {
        await this.ensureDB();
        
        if (!artist || !album || artist === i18n.t('common.unknownArtist') || album === i18n.t('common.unknownAlbum')) {
            return null;
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['covers'], 'readonly');
            const store = transaction.objectStore('covers');
            const index = store.index('artistAlbum');
            const request = index.get([artist, album]);
            
            request.onsuccess = () => {
                const cover = request.result;
                if (cover) {
                    resolve({ id: cover.id, data: cover.data });
                } else {
                    resolve(null);
                }
            };
            
            request.onerror = () => {
                console.error('Failed to find cover:', request.error);
                reject(request.error);
            };
        });
    }

    async updateSongCoverId(songId, coverId) {
        await this.ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['songs'], 'readwrite');
            const store = transaction.objectStore('songs');
            
            const getRequest = store.get(songId);
            
            getRequest.onsuccess = () => {
                const record = getRequest.result;
                if (!record) {
                    reject(new Error(i18n.t('errors.songNotFound')));
                    return;
                }
                
                record.coverId = coverId;
                record.metadata.hasCover = true;
                
                const putRequest = store.put(record);
                
                putRequest.onsuccess = () => {
                    console.log(`Updated song cover ID: ${record.metadata.title}`);
                    resolve({ success: true });
                };
                
                putRequest.onerror = () => {
                    console.error(`Failed to update song cover ID: ${record.metadata.title}`, putRequest.error);
                    reject(putRequest.error);
                };
            };
            
            getRequest.onerror = () => {
                console.error('Failed to query song:', getRequest.error);
                reject(getRequest.error);
            };
        });
    }

    async deleteSongs(songIds) {
        await this.ensureDB();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['songs'], 'readwrite');
            const store = transaction.objectStore('songs');
            
            let completed = 0;
            const total = songIds.length;
            
            songIds.forEach(songId => {
                const getRequest = store.get(songId);
                
                getRequest.onsuccess = () => {
                    const record = getRequest.result;
                    if (record) {
                        record.deleted = true;
                        record.deletedTime = Date.now();
                        
                        const putRequest = store.put(record);
                        
                        putRequest.onsuccess = () => {
                            console.log(`Marked as deleted: ${record.metadata.title} (ID: ${songId})`);
                            completed++;
                            if (completed === total) {
                                resolve({ success: true, count: total });
                            }
                        };
                        
                        putRequest.onerror = () => {
                            console.error(`Failed to mark as deleted: ${record.metadata.title}`, putRequest.error);
                            completed++;
                            if (completed === total) {
                                resolve({ success: false, count: completed });
                            }
                        };
                    } else {
                        completed++;
                        if (completed === total) {
                            resolve({ success: true, count: completed });
                        }
                    }
                };
                
                getRequest.onerror = () => {
                    console.error(`Query failed: ${songId}`, getRequest.error);
                    completed++;
                    if (completed === total) {
                        resolve({ success: false, count: completed });
                    }
                };
            });
        });
    }

    async restoreSongs(songIds) {
        await this.ensureDB();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['songs'], 'readwrite');
            const store = transaction.objectStore('songs');
            
            let completed = 0;
            const total = songIds.length;
            
            songIds.forEach(songId => {
                const getRequest = store.get(songId);
                
                getRequest.onsuccess = () => {
                    const record = getRequest.result;
                    if (record && record.deleted) {
                        record.deleted = false;
                        delete record.deletedTime;
                        
                        const putRequest = store.put(record);
                        
                        putRequest.onsuccess = () => {
                            console.log(`Restored song: ${record.metadata.title} (ID: ${songId})`);
                            completed++;
                            if (completed === total) {
                                resolve({ success: true, count: total });
                            }
                        };
                        
                        putRequest.onerror = () => {
                            console.error(`Failed to restore: ${record.metadata.title}`, putRequest.error);
                            completed++;
                            if (completed === total) {
                                resolve({ success: false, count: completed });
                            }
                        };
                    } else {
                        completed++;
                        if (completed === total) {
                            resolve({ success: true, count: completed });
                        }
                    }
                };
                
                getRequest.onerror = () => {
                    console.error(`Query failed: ${songId}`, getRequest.error);
                    completed++;
                    if (completed === total) {
                        resolve({ success: false, count: completed });
                    }
                };
            });
        });
    }

    async updateSongMetadata(songId, metadata, coverUrl = null) {
        await this.ensureDB();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['songs'], 'readwrite');
            const store = transaction.objectStore('songs');
            
            const getRequest = store.get(songId);
            
            getRequest.onsuccess = async () => {
                const record = getRequest.result;
                if (!record) {
                    console.error(`Song record not found: ${songId}`);
                    reject(new Error(i18n.t('errors.songNotFound')));
                    return;
                }
                
                if (metadata) {
                    record.metadata = {
                        ...record.metadata,
                        title: metadata.title ? this.convertByBrowserLocale(metadata.title) : record.metadata.title,
                        artist: metadata.artist ? this.convertByBrowserLocale(metadata.artist) : record.metadata.artist,
                        album: metadata.album ? this.convertByBrowserLocale(metadata.album) : record.metadata.album,
                        year: metadata.year || record.metadata.year,
                        duration: metadata.duration || record.metadata.duration,
                        mbid: metadata.mbid,
                        releases: metadata.releases
                    };
                }
                
                if (coverUrl) {
                    record.coverUrl = coverUrl;
                    record.metadata.hasCover = true;
                }
                
                const putRequest = store.put(record);
                
                putRequest.onsuccess = () => {
                    console.log(`Metadata updated successfully: ${record.metadata.title}`);
                    resolve({ success: true });
                };
                
                putRequest.onerror = () => {
                    console.error(`Failed to update metadata: ${record.metadata.title}`, putRequest.error);
                    reject(putRequest.error);
                };
            };
            
            getRequest.onerror = () => {
                console.error(`Failed to query song: ${songId}`, getRequest.error);
                reject(getRequest.error);
            };
        });
    }

    async updateSongLyrics(songId, syncedLyrics) {
        await this.ensureDB();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['songs'], 'readwrite');
            const store = transaction.objectStore('songs');
            
            const getRequest = store.get(songId);
            
            getRequest.onsuccess = () => {
                const record = getRequest.result;
                if (!record) {
                    console.error(`Song record not found: ${songId}`);
                    reject(new Error(i18n.t('errors.songNotFound')));
                    return;
                }
                
                record.lyrics = syncedLyrics;
                
                const putRequest = store.put(record);
                
                putRequest.onsuccess = () => {
                    console.log(`Lyrics saved successfully: ${record.metadata.title}`);
                    resolve({ success: true });
                };
                
                putRequest.onerror = () => {
                    console.error(`Failed to save lyrics`, putRequest.error);
                    reject(putRequest.error);
                };
            };
            
            getRequest.onerror = () => {
                console.error(`Failed to query song: ${songId}`, getRequest.error);
                reject(getRequest.error);
            };
        });
    }

    async getSongLyrics(songId) {
        await this.ensureDB();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['songs'], 'readonly');
            const store = transaction.objectStore('songs');
            
            const getRequest = store.get(songId);
            
            getRequest.onsuccess = () => {
                const record = getRequest.result;
                if (!record) {
                    resolve(null);
                    return;
                }
                
                resolve(record.lyrics || null);
            };
            
            getRequest.onerror = () => {
                console.error(`Failed to query lyrics: ${songId}`, getRequest.error);
                reject(getRequest.error);
            };
        });
    }

    initMusicMetadata() {
        try {
            if (typeof jsmediatags !== 'undefined') {
                console.log('jsmediatags library loaded');
            } else if (typeof window !== 'undefined' && window.jsmediatags) {
                console.log('jsmediatags library loaded (window)');
            } else {
                console.warn('jsmediatags library not found, will use fallback parsing method');
            }
        } catch (error) {
            console.warn('jsmediatags initialization failed:', error);
        }
    }
    
    fixEncoding(text) {
        if (!text || typeof text !== 'string') {
            return text;
        }
        
        text = text.trim();
        
        if (!text) {
            return text;
        }
        
        const hasGarbled = /[\u00c0-\u00ff]{2,}/.test(text) || 
                          /[\u0080-\u00ff]/.test(text) && !/[\u4e00-\u9fa5]/.test(text);
        
        if (!hasGarbled) {
            return text;
        }
        
        console.log(`Detected garbled text: "${text}"`);
        
        try {
            const bytes = new Uint8Array(text.length);
            for (let i = 0; i < text.length; i++) {
                bytes[i] = text.charCodeAt(i) & 0xFF;
            }
            
            const gbkDecoder = new TextDecoder('gbk');
            const gbkText = gbkDecoder.decode(bytes);
            
            console.log(`GBK decode result: "${gbkText}"`);
            
            if (/[\u4e00-\u9fa5]/.test(gbkText) && !/[\u00c0-\u00ff]/.test(gbkText)) {
                const result = gbkText.trim();
                console.log(`Encoding fixed (GBK): "${text}" -> "${result}"`);
                return result;
            }
            
            const gb18030Decoder = new TextDecoder('gb18030');
            const gb18030Text = gb18030Decoder.decode(bytes);
            
            console.log(`GB18030 decode result: "${gb18030Text}"`);
            
            if (/[\u4e00-\u9fa5]/.test(gb18030Text) && !/[\u00c0-\u00ff]/.test(gb18030Text)) {
                const result = gb18030Text.trim();
                console.log(`Encoding fixed (GB18030): "${text}" -> "${result}"`);
                return result;
            }
            
            const big5Decoder = new TextDecoder('big5');
            const big5Text = big5Decoder.decode(bytes);
            
            console.log(`Big5 decode result: "${big5Text}"`);
            
            if (/[\u4e00-\u9fa5]/.test(big5Text) && !/[\u00c0-\u00ff]/.test(big5Text)) {
                const result = big5Text.trim();
                console.log(`Encoding fixed (Big5): "${text}" -> "${result}"`);
                return result;
            }
            
            console.log(`Encoding fix failed, keeping original text: "${text}"`);
            return text;
        } catch (error) {
            console.warn('Encoding fix failed:', error);
            return text;
        }
    }

    parseFilename(filename) {
        let name = filename.replace(/\.[^/.]+$/, '');
        
        const patterns = [
            /^([^-]+)\s*-\s*(.+)$/,
            /^([^—]+)\s*—\s*(.+)$/,
            /^([^_]+)_([^_]+)$/,
            /^\[([^\]]+)\]\s*(.+)$/,
            /^【([^】]+)】\s*(.+)$/
        ];
        
        for (const pattern of patterns) {
            const match = name.match(pattern);
            if (match) {
                let artist = match[1].trim();
                let title = match[2].trim();
                
                title = title.replace(/^\d+[\.\-\s]+/, '');
                title = title.replace(/\s*[\(\[【].*?[\)\]】]\s*/g, '').trim();
                
                return { artist, title };
            }
        }
        
        return { artist: null, title: name };
    }

    parseMetadata(file, fileInfo) {
        return new Promise((resolve) => {
            try {
                if (typeof jsmediatags === 'undefined') {
                    console.log(`Using fallback parsing: ${fileInfo.name}`);
                    const parsedInfo = {
                        title: this.convertByBrowserLocale(fileInfo.name.replace(/\.[^/.]+$/, '')),
                        artist: i18n.t('common.unknownArtist'),
                        album: i18n.t('common.unknownAlbum'),
                        year: '',
                        hasCover: false,
                        duration: 0,
                        file: file,
                        handle: fileInfo.handle,
                        originalFilename: fileInfo.name
                    };
                    
                    const audio = new Audio();
                    audio.src = URL.createObjectURL(file);
                    
                    audio.addEventListener('loadedmetadata', () => {
                        parsedInfo.duration = audio.duration;
                        console.log(`  Title: ${parsedInfo.title}`);
                        console.log(`  Artist: ${parsedInfo.artist}`);
                        console.log(`  Album: ${parsedInfo.album}`);
                        console.log(`  Duration: ${this.formatTime(parsedInfo.duration)}`);
                        
                        URL.revokeObjectURL(audio.src);
                        resolve(parsedInfo);
                    });
                    
                    audio.addEventListener('error', () => {
                        console.log(`  Title: ${parsedInfo.title}`);
                        console.log(`  Artist: ${parsedInfo.artist}`);
                        console.log(`  Album: ${parsedInfo.album}`);
                        console.log(`  Duration: Unable to get`);
                        
                        URL.revokeObjectURL(audio.src);
                        resolve(parsedInfo);
                    });
                    
                    return;
                }

                jsmediatags.read(file, {
                    onSuccess: (tag) => {
                        console.log(`Parse successful: ${fileInfo.name}`);
                        console.log('Full parse result:', tag);
                        console.log('Tag info:', tag.tags);
                        
                        const tags = tag.tags;
                        const self = this;
                        
                        const isrc = tags.TSRC ? tags.TSRC.data : null;
                        const mbid = tags.UFID ? tags.UFID.data : null;
                        
                        console.log(`  ISRC: ${isrc || 'None'}`);
                        console.log(`  MBID: ${mbid || 'None'}`);
                        
                        let coverData = null;
                        if (tags.picture && tags.picture.data) {
                            coverData = tags.picture.data;
                            console.log(`  Cover format: ${tags.picture.format}`);
                        }
                        
                        const parsedInfo = {
                            title: this.convertByBrowserLocale(this.fixEncoding(tags.title) || fileInfo.name.replace(/\.[^/.]+$/, '')),
                            artist: this.convertByBrowserLocale(this.fixEncoding(tags.artist) || i18n.t('common.unknownArtist')),
                            album: this.convertByBrowserLocale(this.fixEncoding(tags.album) || i18n.t('common.unknownAlbum')),
                            year: this.fixEncoding(tags.year) || '',
                            hasCover: !!coverData,
                            coverData: coverData,
                            duration: 0,
                            file: file,
                            handle: fileInfo.handle,
                            originalFilename: fileInfo.name
                        };

                        const audio = new Audio();
                        audio.src = URL.createObjectURL(file);
                        
                        audio.addEventListener('loadedmetadata', function() {
                            parsedInfo.duration = audio.duration;
                            console.log(`  Title: ${parsedInfo.title}`);
                            console.log(`  Artist: ${parsedInfo.artist}`);
                            console.log(`  Album: ${parsedInfo.album}`);
                            console.log(`  Year: ${parsedInfo.year || 'Unknown'}`);
                            console.log(`  Cover: ${parsedInfo.hasCover ? 'Yes' : 'No'}`);
                            console.log(`  Duration: ${self.formatTime(parsedInfo.duration)}`);
                            
                            URL.revokeObjectURL(audio.src);
                            resolve(parsedInfo);
                        });
                        
                        audio.addEventListener('error', function() {
                            console.log(`  Title: ${parsedInfo.title}`);
                            console.log(`  Artist: ${parsedInfo.artist}`);
                            console.log(`  Album: ${parsedInfo.album}`);
                            console.log(`  Year: ${parsedInfo.year || 'Unknown'}`);
                            console.log(`  Cover: ${parsedInfo.hasCover ? 'Yes' : 'No'}`);
                            console.log(`  Duration: Unable to get`);
                            
                            URL.revokeObjectURL(audio.src);
                            resolve(parsedInfo);
                        });
                    },
                    onError: (error) => {
                        console.error(`Parse failed: ${fileInfo.name}, error: ${error.info}`);
                        
                        const parsedInfo = {
                            title: this.convertByBrowserLocale(fileInfo.name.replace(/\.[^/.]+$/, '')),
                            artist: i18n.t('common.unknownArtist'),
                            album: i18n.t('common.unknownAlbum'),
                            year: '',
                            hasCover: false,
                            duration: 0,
                            file: file,
                            handle: fileInfo.handle,
                            originalFilename: fileInfo.name
                        };
                        
                        const audio = new Audio();
                        audio.src = URL.createObjectURL(file);
                        
                        audio.addEventListener('loadedmetadata', () => {
                            parsedInfo.duration = audio.duration;
                            console.log(`  Title: ${parsedInfo.title}`);
                            console.log(`  Artist: ${parsedInfo.artist}`);
                            console.log(`  Album: ${parsedInfo.album}`);
                            console.log(`  Duration: ${this.formatTime(parsedInfo.duration)}`);
                            
                            URL.revokeObjectURL(audio.src);
                            resolve(parsedInfo);
                        });
                        
                        audio.addEventListener('error', () => {
                            console.log(`  Title: ${parsedInfo.title}`);
                            console.log(`  Artist: ${parsedInfo.artist}`);
                            console.log(`  Album: ${parsedInfo.album}`);
                            console.log(`  Duration: Unable to get`);
                            
                            URL.revokeObjectURL(audio.src);
                            resolve(parsedInfo);
                        });
                    }
                });
            } catch (error) {
                console.error(`Parse failed: ${fileInfo.name}, error: ${error.message}`);
                
                const parsedInfo = {
                    title: this.convertByBrowserLocale(fileInfo.name.replace(/\.[^/.]+$/, '')),
                    artist: i18n.t('common.unknownArtist'),
                    album: i18n.t('common.unknownAlbum'),
                    year: '',
                    hasCover: false,
                    duration: 0,
                    file: file,
                    handle: fileInfo.handle,
                    originalFilename: fileInfo.name
                };
                
                const audio = new Audio();
                audio.src = URL.createObjectURL(file);
                
                audio.addEventListener('loadedmetadata', () => {
                    parsedInfo.duration = audio.duration;
                    console.log(`  Title: ${parsedInfo.title}`);
                    console.log(`  Artist: ${parsedInfo.artist}`);
                    console.log(`  Album: ${parsedInfo.album}`);
                    console.log(`  Duration: ${this.formatTime(parsedInfo.duration)}`);
                    
                    URL.revokeObjectURL(audio.src);
                    resolve(parsedInfo);
                });
                
                audio.addEventListener('error', () => {
                    console.log(`  Title: ${parsedInfo.title}`);
                    console.log(`  Artist: ${parsedInfo.artist}`);
                    console.log(`  Album: ${parsedInfo.album}`);
                    console.log(`  Duration: Unable to get`);
                    
                    URL.revokeObjectURL(audio.src);
                    resolve(parsedInfo);
                });
            }
        });
    }

    isAudioFile(filename) {
        return this.audioExtensions.some(ext => filename.toLowerCase().endsWith(ext));
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    async scanDirectory(dirHandle, onProgress = null) {
        const audioFiles = [];
        let fileCount = 0;

        async function scanRecursive(handle, path = '') {
            for await (const entry of handle.values()) {
                const entryPath = path ? `${path}/${entry.name}` : entry.name;

                if (entry.kind === 'file') {
                    if (this.isAudioFile(entry.name)) {
                        const file = await entry.getFile();
                        const fileInfo = {
                            name: entry.name,
                            path: entryPath,
                            size: file.size,
                            handle: entry
                        };
                        audioFiles.push(fileInfo);
                        fileCount++;

                        if (onProgress) {
                            onProgress(entryPath, file.size, fileCount);
                        }
                    }
                } else if (entry.kind === 'directory') {
                    await scanRecursive.call(this, entry, entryPath);
                }
            }
        }

        await scanRecursive.call(this, dirHandle);

        return audioFiles;
    }

    async importFromFolder(onProgress = null, onComplete = null) {
        try {
            if (!window.showDirectoryPicker) {
                throw new Error(i18n.t('errors.browserNotSupported'));
            }

            this.cancelImport = false;
            const dirHandle = await window.showDirectoryPicker();
            console.log(`Starting folder scan: ${dirHandle.name}`);

            if (onProgress) {
                onProgress('start', {});
            }

            const audioFiles = await this.scanDirectory(dirHandle, (path, size, count) => {
                const sizeMB = (size / 1024 / 1024).toFixed(2);
                console.log(`Scanning: ${path} (${sizeMB} MB)`);
                
                if (onProgress) {
                    onProgress('scan', { path, size, count, total: 0 });
                }
            });

            console.log(`Scan complete, found ${audioFiles.length} audio files`);
            console.log('Starting metadata parsing...');

            const parsedFiles = [];
            for (let i = 0; i < audioFiles.length; i++) {
                if (this.cancelImport) {
                    console.log('User cancelled import');
                    throw new Error('Import cancelled');
                }

                const fileInfo = audioFiles[i];
                const file = await fileInfo.handle.getFile();
                const parsedInfo = await this.parseMetadata(file, fileInfo);
                parsedFiles.push(parsedInfo);

                if (onProgress) {
                    onProgress('parse', { 
                        current: i + 1, 
                        total: audioFiles.length,
                        file: parsedInfo.title 
                    });
                }
            }

            if (this.cancelImport) {
                console.log('User cancelled import');
                throw new Error('Import cancelled');
            }

            console.log(`Metadata parsing complete, parsed ${parsedFiles.length} files`);
            console.log('Starting to save to database...');

            if (onProgress) {
                onProgress('save', { current: 0, total: parsedFiles.length });
            }

            const { newCount, duplicateCount } = await this.saveBatchToDB(parsedFiles);

            if (onComplete) {
                onComplete(parsedFiles, { newCount, duplicateCount });
            }

            this.enrichMetadataAsync(parsedFiles);

            return parsedFiles;
        } catch (error) {
            if (error.name !== 'AbortError' && error.message !== 'Import cancelled') {
                console.error('Import folder error:', error);
                throw error;
            }
            return [];
        }
    }

    cancelImportOperation() {
        this.cancelImport = true;
    }

    async importFromFiles(onProgress = null, onComplete = null) {
        try {
            if (!window.showOpenFilePicker) {
                throw new Error(i18n.t('errors.browserNotSupportedFiles'));
            }

            this.cancelImport = false;
            const fileHandles = await window.showOpenFilePicker({
                multiple: true,
                types: [
                    {
                        description: 'Audio',
                        accept: {
                            'audio/mpeg': ['.mp3'],
                            'audio/flac': ['.flac']
                        }
                    }
                ]
            });

            if (onProgress) {
                onProgress('start', {});
            }

            const audioFiles = [];

            for (let i = 0; i < fileHandles.length; i++) {
                if (this.cancelImport) {
                    console.log('User cancelled import');
                    throw new Error('Import cancelled');
                }

                const handle = fileHandles[i];
                const file = await handle.getFile();
                
                if (this.isAudioFile(file.name)) {
                    const fileInfo = {
                        name: file.name,
                        path: file.name,
                        size: file.size,
                        handle: handle
                    };
                    audioFiles.push(fileInfo);

                    const sizeMB = (file.size / 1024 / 1024).toFixed(2);
                    console.log(`Scanning: ${file.name} (${sizeMB} MB)`);

                    if (onProgress) {
                        onProgress('scan', { path: file.name, size: file.size, count: i + 1, total: 0 });
                    }
                }
            }

            if (this.cancelImport) {
                console.log('User cancelled import');
                throw new Error('Import cancelled');
            }

            console.log(`Scan complete, found ${audioFiles.length} audio files`);
            console.log('Starting metadata parsing...');

            const parsedFiles = [];
            for (let i = 0; i < audioFiles.length; i++) {
                if (this.cancelImport) {
                    console.log('User cancelled import');
                    throw new Error('Import cancelled');
                }

                const fileInfo = audioFiles[i];
                const file = await fileInfo.handle.getFile();
                const parsedInfo = await this.parseMetadata(file, fileInfo);
                parsedFiles.push(parsedInfo);

                if (onProgress) {
                    onProgress('parse', { 
                        current: i + 1, 
                        total: audioFiles.length,
                        file: parsedInfo.title 
                    });
                }
            }

            if (this.cancelImport) {
                console.log('User cancelled import');
                throw new Error('Import cancelled');
            }

            console.log(`Metadata parsing complete, parsed ${parsedFiles.length} files`);
            console.log('Starting to save to database...');

            if (onProgress) {
                onProgress('save', { current: 0, total: parsedFiles.length });
            }

            const { newCount, duplicateCount } = await this.saveBatchToDB(parsedFiles);

            if (onComplete) {
                onComplete(parsedFiles, { newCount, duplicateCount });
            }

            this.enrichMetadataAsync(parsedFiles);

            return parsedFiles;
        } catch (error) {
            if (error.name !== 'AbortError' && error.message !== 'Import cancelled') {
                console.error('Import file error:', error);
                throw error;
            }
            return [];
        }
    }

    async enrichMetadataAsync(parsedFiles) {
        if (!window.MusicBrainzClient) {
            console.log('MusicBrainzClient not loaded, skipping metadata enrichment');
            return;
        }

        const needsEnrichment = parsedFiles.filter(file => {
            const hasMissingMetadata = 
                file.artist === i18n.t('common.unknownArtist') || 
                file.album === i18n.t('common.unknownAlbum') ||
                !file.duration;
            return hasMissingMetadata;
        });

        if (needsEnrichment.length === 0) {
            console.log('All song metadata complete, no enrichment needed');
            return;
        }

        console.log(`Found ${needsEnrichment.length} songs needing metadata enrichment, starting async processing...`);
        for (const file of needsEnrichment) {
            this.enrichSingleFile(file).catch(error => {
                console.error(`Failed to enrich metadata: ${file.title}`, error);
            });
        }
    }

    async enrichSingleFile(file) {
        if (!file.id) {
            console.log(`Skipping file without ID: ${file.title}`);
            return;
        }

        console.log(`\n========== Starting metadata enrichment ==========`);
        console.log(`Original info:`);
        console.log(`  Title: ${file.title}`);
        console.log(`  Artist: ${file.artist}`);
        console.log(`  Album: ${file.album}`);
        console.log(`  Duration: ${file.duration ? this.formatTime(file.duration) : 'Unknown'}`);

        let titleFromFile = file.title;
        let artistFromFile = file.artist !== i18n.t('common.unknownArtist') ? file.artist : null;

        if (!artistFromFile && file.originalFilename) {
            const parsed = this.parseFilename(file.originalFilename);
            if (parsed.artist) {
                console.log(`\nParsed from filename:`);
                console.log(`  Artist: ${parsed.artist}`);
                console.log(`  Title: ${parsed.title}`);
                artistFromFile = parsed.artist;
                titleFromFile = parsed.title;
            }
        }

        let info = null;
        
        try {
            if (artistFromFile) {
                console.log(`\nFirst query: title="${titleFromFile}", artist="${artistFromFile}"`);
                const searchResult = await MusicBrainzClient.searchRecording(titleFromFile, artistFromFile);
                info = MusicBrainzClient.parseRecordingResult(searchResult, artistFromFile);
                
                if (info) {
                    const artistMatch = this.checkArtistMatch(artistFromFile, info.artistList);
                    if (!artistMatch) {
                        console.log(`  Artist mismatch: "${artistFromFile}" vs "${info.artist}", trying title-only query`);
                        info = null;
                    }
                }
            }
            
            if (!info) {
                console.log(`\nSecond query: title only="${titleFromFile}"`);
                const searchResult = await MusicBrainzClient.searchRecording(titleFromFile, null);
                info = MusicBrainzClient.parseRecordingResult(searchResult, artistFromFile);
                
                if (info && artistFromFile) {
                    const artistMatch = this.checkArtistMatch(artistFromFile, info.artistList);
                    console.log(`  Artist comparison: filename="${artistFromFile}", result="${info.artist}", match=${artistMatch}`);
                }
            }

            if (!info) {
                console.log(`No matching recording found: ${titleFromFile}`);
                return;
            }

            console.log(`\nMusicBrainz query result:`);
            console.log(`  Title: ${info.title}`);
            console.log(`  Artist: ${info.artist}`);
            console.log(`  Duration: ${info.duration ? this.formatTime(info.duration) : 'Unknown'}`);
            console.log(`  MBID: ${info.mbid}`);
            
            if (info.releases && info.releases.length > 0) {
                console.log(`  Found ${info.releases.length} albums:`);
                info.releases.forEach((rel, idx) => {
                    console.log(`    ${idx + 1}. ${rel.title} (${rel.year || 'Unknown year'}) - ${rel.country || 'Unknown country'} [MBID: ${rel.mbid}]`);
                });
            }

            const metadata = {
                title: this.convertByBrowserLocale(info.title),
                artist: this.convertByBrowserLocale(info.artist),
                duration: info.duration,
                mbid: info.mbid,
                releases: info.releases
            };

            if (info.releases && info.releases.length > 0) {
                metadata.album = this.convertByBrowserLocale(info.releases[0].title);
                metadata.year = info.releases[0].year;
            }

            try {
                await this.updateSongMetadata(file.id, metadata, null);
                console.log(`\nMetadata updated: ${metadata.title}`);
                
                window.dispatchEvent(new CustomEvent('songMetadataUpdated', {
                    detail: {
                        songId: file.id,
                        metadata: metadata,
                        coverUrl: null
                    }
                }));
            } catch (dbError) {
                console.error(`Failed to update metadata: ${metadata.title}`, dbError);
            }

            console.log(`========================================\n`);
        } catch (error) {
            console.error(`Metadata enrichment error: ${titleFromFile}`, error);
        }
    }

    checkArtistMatch(localArtist, remoteArtists) {
        if (!localArtist) return false;
        
        if (typeof remoteArtists === 'string') {
            remoteArtists = [remoteArtists];
        }
        
        if (!remoteArtists || remoteArtists.length === 0) return false;
        
        const normalize = (str) => {
            return this.toSimplified(str.toLowerCase())
                .replace(/[&、,，\/\\]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        };
        
        const localNorm = normalize(localArtist);
        const localArtistList = localNorm.split(/\s+/).filter(a => a.length > 0);
        
        const remoteNormList = remoteArtists.map(a => normalize(a)).filter(a => a.length > 0);
        
        let matchCount = 0;
        for (const la of localArtistList) {
            for (const ra of remoteNormList) {
                if (la === ra || la.includes(ra) || ra.includes(la)) {
                    matchCount++;
                    break;
                }
            }
        }
        
        if (matchCount === localArtistList.length && matchCount === remoteNormList.length) {
            return true;
        }
        
        if (matchCount >= Math.min(localArtistList.length, remoteNormList.length)) {
            return true;
        }
        
        return false;
    }

    toSimplified(str) {
        if (typeof OpenCC !== 'undefined') {
            const converter = OpenCC.Converter({ from: 'tw', to: 'cn' });
            return converter(str);
        }
        return str;
    }

    toTraditional(str) {
        if (typeof OpenCC !== 'undefined') {
            const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });
            return converter(str);
        }
        return str;
    }

    convertByBrowserLocale(str) {
        if (!str) return str;
        
        const lang = navigator.language || navigator.userLanguage || 'zh-CN';
        const isTraditionalLocale = lang === 'zh-TW' || lang === 'zh-HK' || lang.startsWith('zh-Hant');
        
        if (isTraditionalLocale) {
            return this.toTraditional(str);
        } else {
            return this.toSimplified(str);
        }
    }

    normalizeArtistForCompare(artist) {
        if (!artist) return [];
        const normalized = this.toSimplified(artist.toLowerCase())
            .replace(/[&、,，\/\\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return normalized.split(/\s+/).filter(a => a.length > 0).sort();
    }

    compareAlbumNames(localAlbum, remoteAlbum) {
        const localNorm = this.toSimplified(localAlbum).toLowerCase().trim();
        const remoteNorm = this.toSimplified(remoteAlbum).toLowerCase().trim();
        
        if (localNorm === remoteNorm) return true;
        
        const localClean = localNorm.replace(/\s*[\(\[（【].*?[\)\]）】]\s*/g, '').trim();
        const remoteClean = remoteNorm.replace(/\s*[\(\[（【].*?[\)\]）】]\s*/g, '').trim();
        
        if (localClean && remoteClean && localClean === remoteClean) return true;
        
        if (localNorm.includes(remoteNorm) || remoteNorm.includes(localNorm)) return true;
        
        if (localClean && remoteClean && (localClean.includes(remoteClean) || remoteClean.includes(localClean))) return true;
        
        return false;
    }

    compareArtistSets(artist1, artist2) {
        const set1 = this.normalizeArtistForCompare(artist1);
        const set2 = this.normalizeArtistForCompare(artist2);
        
        if (set1.length === 0 || set2.length === 0) return false;
        if (set1.length !== set2.length) return false;
        
        return set1.every((a, i) => a === set2[i]);
    }

    enqueueCoverFetch(songId, artist, album, releases) {
        this.coverQueue = this.coverQueue.then(async () => {
            try {
                await this.fetchCoverForSong(songId, artist, album, releases);
            } catch (error) {
                console.error(`Failed to fetch cover: ${artist} - ${album}`, error);
            }
        });
    }

    enqueueCoverFetchWithQuery(songId, title, artist, album) {
        this.coverQueue = this.coverQueue.then(async () => {
            try {
                console.log(`\n========== Fetching cover (no MBID) ==========`);
                console.log(`Song: ${artist} - ${title} - ${album}`);

                const iTunesResult = await this.fetchCoverFromITunes(artist, album);
                if (iTunesResult && iTunesResult.coverUrl) {
                    const coverId = await this.saveCoverFromUrl(iTunesResult.coverUrl, songId, artist, album);
                    if (coverId) {
                        console.log(`========== Cover fetched successfully (iTunes) ==========\n`);
                        return;
                    }
                }

                console.log(`\n--- iTunes not found, trying MusicBrainz query ---`);
                
                const searchResult = await MusicBrainzClient.searchRecording(title, artist);
                const info = MusicBrainzClient.parseRecordingResult(searchResult, artist);
                
                if (!info || !info.releases || info.releases.length === 0) {
                    console.log(`No releases found: ${artist} - ${title}`);
                    console.log(`========== No cover found ==========\n`);
                    return;
                }
                
                console.log(`Found ${info.releases.length} releases`);
                
                await this.updateSongReleases(songId, info.releases);

                const caaResult = await this.fetchCoverFromCAA(songId, artist, album, info.releases);
                if (caaResult.success && caaResult.coverUrl) {
                    const coverId = await this.saveCoverFromUrl(caaResult.coverUrl, songId, artist, caaResult.releaseAlbum || album);
                    if (coverId) {
                        if (!caaResult.albumMatch && caaResult.releaseAlbum) {
                            const convertedAlbum = this.convertByBrowserLocale(caaResult.releaseAlbum);
                            console.log(`\nUpdating album name: ${album} → ${convertedAlbum}`);
                            await this.updateSongAlbum(songId, convertedAlbum);
                            
                            window.dispatchEvent(new CustomEvent('songAlbumUpdated', {
                                detail: {
                                    songId: songId,
                                    album: convertedAlbum
                                }
                            }));
                        }
                        console.log(`========== Cover fetched successfully (CAA) ==========\n`);
                        return;
                    }
                }
                
                console.log(`========== No cover found ==========\n`);
            } catch (error) {
                console.error(`Failed to fetch cover: ${artist} - ${title}`, error);
            }
        });
    }

    async updateSongReleases(songId, releases) {
        await this.ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['songs'], 'readwrite');
            const store = transaction.objectStore('songs');
            
            const getRequest = store.get(songId);
            
            getRequest.onsuccess = () => {
                const record = getRequest.result;
                if (!record) {
                    console.error(`Song record not found: ${songId}`);
                    reject(new Error(i18n.t('errors.songNotFound')));
                    return;
                }
                
                record.metadata.releases = releases;
                
                const putRequest = store.put(record);
                
                putRequest.onsuccess = () => {
                    console.log(`Releases updated successfully`);
                    
                    window.dispatchEvent(new CustomEvent('songReleasesUpdated', {
                        detail: {
                            songId: songId,
                            releases: releases
                        }
                    }));
                    
                    resolve({ success: true });
                };
                
                putRequest.onerror = () => {
                    console.error(`Failed to update releases`, putRequest.error);
                    reject(putRequest.error);
                };
            };
            
            getRequest.onerror = () => {
                console.error(`Failed to query song: ${songId}`, getRequest.error);
                reject(getRequest.error);
            };
        });
    }

    async fetchCoverForSong(songId, artist, album, releases) {
        console.log(`\n========== Starting cover fetch ==========`);
        console.log(`Song: ${artist} - ${album}`);
        console.log(`Available releases: ${releases ? releases.length : 0}`);

        const iTunesResult = await this.fetchCoverFromITunes(artist, album);
        if (iTunesResult && iTunesResult.coverUrl) {
            const coverId = await this.saveCoverFromUrl(iTunesResult.coverUrl, songId, artist, album);
            if (coverId) {
                console.log(`========== Cover fetched successfully (iTunes) ==========\n`);
                return;
            }
        }

        if (releases && releases.length > 0) {
            const caaResult = await this.fetchCoverFromCAA(songId, artist, album, releases);
            if (caaResult.success && caaResult.coverUrl) {
                const coverId = await this.saveCoverFromUrl(caaResult.coverUrl, songId, artist, caaResult.releaseAlbum || album);
                if (coverId) {
                    if (!caaResult.albumMatch && caaResult.releaseAlbum) {
                        const convertedAlbum = this.convertByBrowserLocale(caaResult.releaseAlbum);
                        console.log(`\nUpdating album name: ${album} → ${convertedAlbum}`);
                        await this.updateSongAlbum(songId, convertedAlbum);
                        
                        window.dispatchEvent(new CustomEvent('songAlbumUpdated', {
                            detail: {
                                songId: songId,
                                album: convertedAlbum
                            }
                        }));
                    }
                    console.log(`========== Cover fetched successfully (CAA) ==========\n`);
                    return;
                }
            }
        }
        
        console.log(`========== No cover found ==========\n`);
    }

    async updateSongAlbum(songId, newAlbum) {
        await this.ensureDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['songs'], 'readwrite');
            const store = transaction.objectStore('songs');
            
            const getRequest = store.get(songId);
            
            getRequest.onsuccess = () => {
                const record = getRequest.result;
                if (!record) {
                    console.error(`Song record not found: ${songId}`);
                    reject(new Error(i18n.t('errors.songNotFound')));
                    return;
                }
                
                record.metadata.album = newAlbum;
                
                const putRequest = store.put(record);
                
                putRequest.onsuccess = () => {
                    console.log(`Album name updated successfully: ${newAlbum}`);
                    resolve({ success: true });
                };
                
                putRequest.onerror = () => {
                    console.error(`Failed to update album name`, putRequest.error);
                    reject(putRequest.error);
                };
            };
            
            getRequest.onerror = () => {
                console.error(`Failed to query song: ${songId}`, getRequest.error);
                reject(getRequest.error);
            };
        });
    }

    async fetchCoverFromITunes(artist, album) {
        console.log(`\n--- Trying iTunes API ---`);
        
        const countries = ['CN', 'TW', 'HK', 'US'];
        const searchTerms = [
            `${artist} ${album}`,
            `${this.toSimplified(artist)} ${this.toSimplified(album)}`,
            `${this.toTraditional(artist)} ${this.toTraditional(album)}`
        ];
        
        const triedUrls = new Set();
        
        for (const country of countries) {
            for (const term of searchTerms) {
                const searchTerm = encodeURIComponent(term);
                const url = `https://itunes.apple.com/search?term=${searchTerm}&media=music&entity=album&limit=10&country=${country}`;
                
                if (triedUrls.has(url)) continue;
                triedUrls.add(url);
                
                try {
                    console.log(`  Request (${country}): ${term}`);
                    
                    const response = await fetch(url);
                    if (!response.ok) {
                        console.log(`  Request failed: ${response.status}`);
                        continue;
                    }
                    
                    const data = await response.json();
                    
                    if (!data.results || data.results.length === 0) {
                        continue;
                    }
                    
                    for (const result of data.results) {
                        const itunesArtist = result.artistName || '';
                        const itunesAlbum = result.collectionName || '';
                        
                        const artistMatch = this.compareArtistSets(artist, itunesArtist);
                        const albumMatch = this.compareAlbumNames(album, itunesAlbum);
                        
                        console.log(`    Checking: ${itunesAlbum} - ${itunesArtist}`);
                        console.log(`      Artist match: ${artistMatch}, Album match: ${albumMatch}`);
                        
                        if (artistMatch && albumMatch) {
                            let coverUrl = result.artworkUrl100;
                            if (coverUrl) {
                                coverUrl = coverUrl.replace('100x100bb', '600x600bb');
                            }
                            
                            console.log(`  iTunes found cover: ${coverUrl}`);
                            return { coverUrl: coverUrl, album: itunesAlbum };
                        }
                    }
                } catch (error) {
                    console.error(`  Request error:`, error);
                }
            }
        }
        
        console.log(`  iTunes no matching results found`);
        return null;
    }

    async fetchCoverFromCAA(songId, artist, album, releases) {
        console.log(`\n--- Trying Cover Art Archive ---`);
        
        if (!releases || releases.length === 0) {
            console.log(`  No releases info`);
            return { success: false };
        }

        const tryFetchCover = async (requireAlbumMatch) => {
            for (const release of releases) {
                const releaseArtist = release.artist || artist;
                const releaseAlbum = release.title;
                
                const artistMatch = this.compareArtistSets(artist, releaseArtist);
                const albumMatch = this.compareAlbumNames(album, releaseAlbum);
                
                console.log(`  Checking release: ${releaseAlbum} - ${releaseArtist}`);
                console.log(`    Artist match: ${artistMatch}, Album match: ${albumMatch}`);
                
                if (!artistMatch) {
                    continue;
                }
                
                if (requireAlbumMatch && !albumMatch) {
                    continue;
                }

                if (!release.mbid) {
                    continue;
                }

                try {
                    const coverUrl = await MusicBrainzClient.getCoverImageUrl(release.mbid);
                    if (!coverUrl) {
                        console.log(`    No cover image found`);
                        continue;
                    }

                    console.log(`    Found cover: ${coverUrl}`);
                    return { success: true, coverUrl: coverUrl, releaseAlbum: releaseAlbum, albumMatch: albumMatch };
                    
                } catch (error) {
                    console.error(`    Error fetching cover:`, error);
                    continue;
                }
            }
            return { success: false };
        };

        let result = await tryFetchCover(true);
        
        if (!result.success) {
            result = await tryFetchCover(false);
        }
        
        return result;
    }

    async saveCoverFromUrl(coverUrl, songId, artist, album) {
        try {
            const response = await fetch(coverUrl);
            if (!response.ok) {
                console.log(`  Failed to download cover: ${response.status}`);
                return null;
            }
            
            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const coverId = await this.calculateCoverCRC32(arrayBuffer);
            
            await this.saveCoverToDB(arrayBuffer, coverId, artist, album);
            await this.updateSongCoverId(songId, coverId);
            
            const currentSong = window.musicPlayer?.currentTrack;
            const isCurrentPlaying = currentSong && currentSong.id === songId;
            
            window.dispatchEvent(new CustomEvent('songCoverUpdated', {
                detail: {
                    songId: songId,
                    coverId: coverId,
                    isCurrentPlaying: isCurrentPlaying
                }
            }));
            
            return coverId;
        } catch (error) {
            console.error(`  Error saving cover:`, error);
            return null;
        }
    }

    async fetchLyricsFromLRCLIB(artist, title, album = null, duration = null) {
        console.log(`\n--- Trying LRCLIB ---`);
        
        const searchTerms = [
            { artist: artist, title: title },
            { artist: this.toSimplified(artist), title: this.toSimplified(title) },
            { artist: this.toTraditional(artist), title: this.toTraditional(title) }
        ];
        
        const triedUrls = new Set();
        
        for (const term of searchTerms) {
            const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(term.artist)}&track_name=${encodeURIComponent(term.title)}`;
            
            if (triedUrls.has(url)) continue;
            triedUrls.add(url);
            
            try {
                console.log(`  Request: ${term.artist} - ${term.title}`);
                
                const response = await fetch(url);
                if (!response.ok) {
                    console.log(`  Request failed: ${response.status}`);
                    continue;
                }
                
                const data = await response.json();
                
                if (data && data.syncedLyrics) {
                    console.log(`  LRCLIB found synced lyrics`);
                    return {
                        syncedLyrics: data.syncedLyrics,
                        plainLyrics: data.plainLyrics,
                        source: 'LRCLIB'
                    };
                }
                
                if (data && data.plainLyrics && !data.syncedLyrics) {
                    console.log(`  LRCLIB found plain lyrics (no timestamps)`);
                }
                
            } catch (error) {
                console.error(`  Request error:`, error);
            }
        }
        
        console.log(`  LRCLIB no synced lyrics found`);
        return null;
    }

    async fetchLyricsFromKugou(artist, title) {
        console.log(`\n--- Trying Kugou Music API ---`);
        
        try {
            const keywords = [
                `${artist} ${title}`,
                `${this.toSimplified(artist)} ${this.toSimplified(title)}`,
                `${this.toTraditional(artist)} ${this.toTraditional(title)}`
            ];
            
            for (const keyword of keywords) {
                const searchUrl = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}&page=1&pagesize=10`;
                
                console.log(`  Search: ${keyword}`);
                
                const searchResponse = await fetch(searchUrl);
                
                if (!searchResponse.ok) {
                    console.log(`  Kugou search failed: ${searchResponse.status}`);
                    continue;
                }
                
                const searchData = await searchResponse.json();
                
                if (!searchData.data || !searchData.data.lists || searchData.data.lists.length === 0) {
                    continue;
                }
                
                for (const song of searchData.data.lists) {
                    const songHash = song.FileHash;
                    const songName = song.SongName;
                    const songArtist = song.SingerName;
                    
                    const artistMatch = this.compareArtistSets(artist, songArtist);
                    const titleMatch = this.toSimplified(title).toLowerCase() === this.toSimplified(songName).toLowerCase() ||
                                       this.toSimplified(title).toLowerCase().includes(this.toSimplified(songName).toLowerCase()) ||
                                       this.toSimplified(songName).toLowerCase().includes(this.toSimplified(title).toLowerCase());
                    
                    console.log(`  Checking: ${songName} - ${songArtist}`);
                    console.log(`    Artist match: ${artistMatch}, Title match: ${titleMatch}`);
                    
                    if (artistMatch && titleMatch && songHash) {
                        const lyricUrl = `https://www.kugou.com/yy/index.php?r=play/getdata&hash=${songHash}`;
                        
                        const lyricResponse = await fetch(lyricUrl);
                        
                        if (!lyricResponse.ok) {
                            console.log(`  Failed to get lyrics: ${lyricResponse.status}`);
                            continue;
                        }
                        
                        const lyricData = await lyricResponse.json();
                        
                        if (lyricData.data && lyricData.data.lyrics) {
                            console.log(`  Kugou found lyrics`);
                            return {
                                syncedLyrics: lyricData.data.lyrics,
                                plainLyrics: null,
                                source: 'Kugou'
                            };
                        }
                    }
                }
            }
            
            console.log(`  Kugou no lyrics found`);
            return null;
            
        } catch (error) {
            console.error(`  Kugou request error:`, error);
            return null;
        }
    }

    async fetchLyrics(artist, title, album = null, duration = null) {
        console.log(`\n========== Starting lyrics fetch ==========`);
        console.log(`Song: ${artist} - ${title}`);
        
        const lrclibResult = await this.fetchLyricsFromLRCLIB(artist, title, album, duration);
        if (lrclibResult && lrclibResult.syncedLyrics) {
            console.log(`========== Lyrics fetched successfully (LRCLIB) ==========\n`);
            return lrclibResult;
        }
        
        // const kugouResult = await this.fetchLyricsFromKugou(artist, title);
        // if (kugouResult && kugouResult.syncedLyrics) {
        //     console.log(`========== Lyrics fetched successfully (Kugou) ==========\n`);
        //     return kugouResult;
        // }
        
        console.log(`========== No lyrics found ==========\n`);
        return null;
    }
}

const fileSystemHandler = new FileSystemHandler();
