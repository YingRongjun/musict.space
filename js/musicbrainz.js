const MusicBrainzClient = {
    USER_ID_KEY: 'musict_user_id',
    REQUEST_INTERVAL: 1000,
    lastRequestTime: 0,
    requestQueue: [],
    isProcessingQueue: false,

    getOrCreateUserId() {
        let userId = localStorage.getItem(this.USER_ID_KEY);
        if (!userId) {
            userId = 'user_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            localStorage.setItem(this.USER_ID_KEY, userId);
        }
        return userId;
    },

    getUserAgent() {
        const userId = this.getOrCreateUserId();
        return `MusicT/1.0 (https://musict.space; ${userId})`;
    },

    getMusicBrainzHeaders() {
        return {
            'User-Agent': this.getUserAgent(),
            'Accept': 'application/json'
        };
    },

    async throttleRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({
                url,
                options,
                resolve,
                reject
            });
            this.processQueue();
        });
    },

    async processQueue() {
        if (this.isProcessingQueue || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            
            if (timeSinceLastRequest < this.REQUEST_INTERVAL) {
                const waitTime = this.REQUEST_INTERVAL - timeSinceLastRequest;
                await this.sleep(waitTime);
            }

            const request = this.requestQueue.shift();
            this.lastRequestTime = Date.now();

            try {
                const response = await fetch(request.url, {
                    ...request.options,
                    headers: {
                        ...this.getMusicBrainzHeaders(),
                        ...request.options.headers
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                request.resolve(data);
            } catch (error) {
                request.reject(error);
            }
        }

        this.isProcessingQueue = false;
    },

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    async searchRecording(title, artist) {
        const titleTraditional = this.toTraditional(title);
        
        let query;
        if (artist) {
            const artistTraditional = this.toTraditional(artist);
            query = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
            const queryTraditional = encodeURIComponent(`recording:"${titleTraditional}" AND artist:"${artistTraditional}"`);
            
            const url = `https://musicbrainz.org/ws/2/recording/?query=${query} OR ${queryTraditional}&fmt=json&limit=20`;
            return this.throttleRequest(url);
        } else {
            query = encodeURIComponent(`recording:"${title}"`);
            const queryTraditional = encodeURIComponent(`recording:"${titleTraditional}"`);
            
            const url = `https://musicbrainz.org/ws/2/recording/?query=${query} OR ${queryTraditional}&fmt=json&limit=20`;
            return this.throttleRequest(url);
        }
    },

    async getCoverArt(releaseMbid) {
        const url = `https://coverartarchive.org/release/${releaseMbid}`;
        
        return this.throttleRequest(url, {
            headers: {
                'Accept': 'application/json'
            }
        });
    },

    async getCoverImageUrl(releaseMbid) {
        try {
            const data = await this.getCoverArt(releaseMbid);
            if (data.images && data.images.length > 0) {
                const front = data.images.find(img => img.front);
                if (front) {
                    return front.thumbnails?.large || front.image;
                }
                return data.images[0].thumbnails?.large || data.images[0].image;
            }
            return null;
        } catch (error) {
            console.error('Failed to get cover:', error);
            return null;
        }
    },

    parseRecordingResult(result, localArtist = null) {
        if (!result || !result.recordings || result.recordings.length === 0) {
            return null;
        }

        const matchedRecordings = [];
        
        if (localArtist) {
            for (const rec of result.recordings) {
                const recArtistCredit = rec['artist-credit'];
                const recArtists = this.extractArtists(recArtistCredit);
                
                if (recArtists.length > 0) {
                    const matchScore = this.getArtistMatchScore(localArtist, recArtists);
                    if (matchScore > 0) {
                        if (rec.releases && rec.releases.length > 0) {
                            for (const rel of rec.releases) {
                                matchedRecordings.push({
                                    recording: rec,
                                    release: rel,
                                    artist: recArtists.join(' '),
                                    artistList: recArtists,
                                    matchScore: matchScore
                                });
                                console.log(`  Matched recording: "${rec.title}" - ${recArtists.join(' ')} (Album: ${rel.title}, MBID: ${rel.id}, Score: ${matchScore})`);
                            }
                        } else {
                            matchedRecordings.push({
                                recording: rec,
                                release: null,
                                artist: recArtists.join(' '),
                                artistList: recArtists,
                                matchScore: matchScore
                            });
                            console.log(`  Matched recording: "${rec.title}" - ${recArtists.join(' ')} (Score: ${matchScore})`);
                        }
                        continue;
                    }
                }
                
                if (rec.releases && rec.releases.length > 0) {
                    for (const rel of rec.releases) {
                        const relArtistCredit = rel['artist-credit'];
                        const relArtists = this.extractArtists(relArtistCredit);
                        
                        const matchScore = this.getArtistMatchScore(localArtist, relArtists);
                        if (matchScore > 0) {
                            matchedRecordings.push({
                                recording: rec,
                                release: rel,
                                artist: relArtists.join(' '),
                                artistList: relArtists,
                                matchScore: matchScore
                            });
                            console.log(`  Matched recording: "${rec.title}" - ${relArtists.join(' ')} (Album: ${rel.title}, MBID: ${rel.id}, Score: ${matchScore})`);
                        }
                    }
                }
            }
        }
        
        if (matchedRecordings.length > 0) {
            matchedRecordings.sort((a, b) => b.matchScore - a.matchScore);
            console.log(`  Sorted by match score, highest: ${matchedRecordings[0].matchScore}`);
        }
        
        if (matchedRecordings.length === 0) {
            console.log(`  No artist-matched recording found, using first result`);
            const firstRec = result.recordings[0];
            const firstArtists = this.extractArtists(firstRec['artist-credit']);
            
            if (firstRec.releases && firstRec.releases.length > 0) {
                for (const rel of firstRec.releases) {
                    const relArtists = this.extractArtists(rel['artist-credit']);
                    const artists = relArtists.length > 0 ? relArtists : firstArtists;
                    matchedRecordings.push({
                        recording: firstRec,
                        release: rel,
                        artist: artists.join(' ') || i18n.t('common.unknownArtist'),
                        artistList: artists,
                        matchScore: 0
                    });
                }
            } else {
                matchedRecordings.push({
                    recording: firstRec,
                    release: null,
                    artist: firstArtists.join(' ') || i18n.t('common.unknownArtist'),
                    artistList: firstArtists,
                    matchScore: 0
                });
            }
        }

        const firstMatch = matchedRecordings[0];
        const recording = firstMatch.recording;
        
        const allReleases = [];
        const releaseMbids = new Set();
        
        const topScore = matchedRecordings[0].matchScore;
        for (const match of matchedRecordings) {
            if (match.matchScore === topScore && match.release) {
                if (!releaseMbids.has(match.release.id)) {
                    releaseMbids.add(match.release.id);
                    allReleases.push({
                        mbid: match.release.id,
                        title: match.release.title,
                        date: match.release.date,
                        year: match.release.date ? parseInt(match.release.date.substring(0, 4)) : null,
                        country: match.release.country
                    });
                }
            }
        }
        
        const info = {
            title: recording.title,
            artist: firstMatch.artist,
            artistList: firstMatch.artistList || [firstMatch.artist],
            duration: recording.length ? Math.round(recording.length / 1000) : 0,
            mbid: recording.id,
            releases: allReleases,
            matchedRecordings: matchedRecordings
        };

        return info;
    },

    extractArtists(artistCredit) {
        if (!artistCredit || !Array.isArray(artistCredit)) {
            if (artistCredit?.name) {
                return [artistCredit.name];
            }
            return [];
        }
        
        const artists = [];
        for (const credit of artistCredit) {
            if (credit.name) {
                artists.push(credit.name);
            } else if (credit.artist?.name) {
                artists.push(credit.artist.name);
            }
        }
        return artists;
    },

    getArtistMatchScore(localArtist, remoteArtists) {
        if (!localArtist) return 0;
        
        if (typeof remoteArtists === 'string') {
            remoteArtists = [remoteArtists];
        }
        
        if (!remoteArtists || remoteArtists.length === 0) return 0;
        
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
        
        if (matchCount === 0) return 0;
        
        if (matchCount === localArtistList.length && matchCount === remoteNormList.length) {
            return 100;
        }
        
        if (matchCount === localArtistList.length) {
            return 80;
        }
        
        if (matchCount === remoteNormList.length) {
            return 70;
        }
        
        return 50;
    },

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
    },

    toSimplified(str) {
        if (typeof OpenCC !== 'undefined') {
            const converter = OpenCC.Converter({ from: 'tw', to: 'cn' });
            return converter(str);
        }
        return str;
    },

    toTraditional(str) {
        if (typeof OpenCC !== 'undefined') {
            const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });
            return converter(str);
        }
        return str;
    },

    convertByBrowserLocale(str) {
        if (!str) return str;
        
        const lang = i18n.locale || navigator.language || navigator.userLanguage || 'zh-CN';
        const isTraditionalLocale = lang === 'zh-TW' || lang === 'zh-HK' || lang.startsWith('zh-Hant');
        
        if (isTraditionalLocale) {
            return this.toTraditional(str);
        } else {
            return this.toSimplified(str);
        }
    }
};

window.MusicBrainzClient = MusicBrainzClient;
