class I18n {
    constructor() {
        this.locale = 'en-US';
        this.translations = {};
        this.fallbackTranslations = {};
        this.fallbackLocale = 'en-US';
        this.storageKey = 'musicPlayerLanguage';
    }

    detectLanguage() {
        const browserLang = navigator.language || navigator.userLanguage || '';
        
        if (browserLang.startsWith('zh-TW') || 
            browserLang.startsWith('zh-HK') || 
            browserLang.startsWith('zh-Hant')) {
            return 'zh-TW';
        } else if (browserLang.startsWith('zh')) {
            return 'zh-CN';
        } else if (browserLang.startsWith('ja')) {
            return 'ja-JP';
        } else if (browserLang.startsWith('ko')) {
            return 'ko-KR';
        } else if (browserLang.startsWith('ru')) {
            return 'ru-RU';
        } else if (browserLang.startsWith('fr')) {
            return 'fr-FR';
        } else if (browserLang.startsWith('de')) {
            return 'de-DE';
        } else if (browserLang.startsWith('pt')) {
            return 'pt-BR';
        } else if (browserLang.startsWith('es')) {
            return 'es-ES';
        } else if (browserLang.startsWith('nl')) {
            return 'nl-NL';
        } else {
            return 'en-US';
        }
    }

    getSavedLanguage() {
        return localStorage.getItem(this.storageKey);
    }

    saveLanguage(lang) {
        localStorage.setItem(this.storageKey, lang);
    }

    async loadLanguage(lang) {
        try {
            const response = await fetch(`locales/${lang}.json`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            
            if (lang === this.fallbackLocale) {
                this.fallbackTranslations = data;
            }
            
            this.translations = data;
            this.locale = lang;
            console.log(`[i18n] Loaded language: ${lang}`);
            return true;
        } catch (error) {
            console.error(`[i18n] Failed to load ${lang}:`, error.message);
            
            if (lang !== this.fallbackLocale) {
                console.log(`[i18n] Falling back to ${this.fallbackLocale}`);
                return this.loadLanguage(this.fallbackLocale);
            }
            return false;
        }
    }

    async init() {
        await this.loadLanguage(this.fallbackLocale);
        
        const savedLang = this.getSavedLanguage();
        let targetLang;
        
        if (savedLang) {
            console.log(`[i18n] Using saved language: ${savedLang}`);
            targetLang = savedLang;
        } else {
            targetLang = this.detectLanguage();
            console.log(`[i18n] Detected browser language: ${targetLang}`);
        }
        
        if (targetLang !== this.fallbackLocale) {
            await this.loadLanguage(targetLang);
        }
        
        this.renderLangOptions();
        this.updateLangSelector();
    }

    updateLangSelector() {
        const langMap = new Map(SUPPORTED_LANGUAGES.map(l => [l.code, l.name]));
        
        const currentLangSpan = document.querySelector('.lang-current');
        if (currentLangSpan) {
            currentLangSpan.textContent = langMap.get(this.locale) || this.locale;
        }
        
        document.querySelectorAll('.lang-option').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === this.locale);
        });
    }
    
    renderLangOptions() {
        const container = document.getElementById('langModalBody');
        if (!container) return;
        
        const itemsPerColumn = 10;
        const totalLangs = SUPPORTED_LANGUAGES.length;
        const columnCount = Math.ceil(totalLangs / itemsPerColumn);
        
        container.innerHTML = '';
        
        for (let i = 0; i < columnCount; i++) {
            const column = document.createElement('div');
            column.className = 'lang-column';
            
            const start = i * itemsPerColumn;
            const end = Math.min(start + itemsPerColumn, totalLangs);
            
            for (let j = start; j < end; j++) {
                const lang = SUPPORTED_LANGUAGES[j];
                const btn = document.createElement('button');
                btn.className = 'lang-option';
                btn.dataset.lang = lang.code;
                btn.textContent = lang.name;
                column.appendChild(btn);
            }
            
            container.appendChild(column);
        }
    }

    async changeLanguage(lang) {
        if (lang === this.locale) {
            return;
        }
        
        const success = await this.loadLanguage(lang);
        if (success) {
            this.saveLanguage(lang);
            this.updateAllElements();
            this.updateLangSelector();
            window.dispatchEvent(new CustomEvent('localeChanged', { detail: { locale: lang } }));
        }
    }

    t(key, params = {}) {
        const result = this.getValue(key, this.translations);
        if (result !== null) {
            return this.interpolate(result, params);
        }
        
        const fallback = this.getValue(key, this.fallbackTranslations);
        if (fallback !== null) {
            console.warn(`[i18n] Key "${key}" not found in ${this.locale}, using fallback`);
            return this.interpolate(fallback, params);
        }
        
        console.warn(`[i18n] Key "${key}" not found`);
        return key;
    }

    getValue(key, translations) {
        const keys = key.split('.');
        let value = translations;
        
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return null;
            }
        }
        
        return typeof value === 'string' ? value : null;
    }

    interpolate(text, params) {
        return text.replace(/\{(\w+)\}/g, (match, key) => {
            return params[key] !== undefined ? params[key] : match;
        });
    }

    async setLocale(locale) {
        if (locale !== this.locale) {
            await this.loadLanguage(locale);
            this.updateAllElements();
            window.dispatchEvent(new CustomEvent('localeChanged', { detail: { locale } }));
        }
    }

    updateAllElements() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = this.t(key);
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.placeholder = this.t(key);
        });

        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.title = this.t(key);
        });
    }

    getLocale() {
        return this.locale;
    }

    getTranslations() {
        return this.translations;
    }
}

const i18n = new I18n();
