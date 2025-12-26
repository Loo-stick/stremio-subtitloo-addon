/**
 * Vérificateur de disponibilité des sous-titres multi-sources
 *
 * Vérifie si des sous-titres français sont disponibles sur :
 * - OpenSubtitles
 * - SubDL
 *
 * @module lib/subtitle-checker
 */

const fetch = require('node-fetch');

/** Timeout des requêtes en ms */
const REQUEST_TIMEOUT = 5000;

/** Durée du rate limit par défaut (5 minutes) */
const DEFAULT_RATE_LIMIT_DURATION = 5 * 60 * 1000;

/**
 * Classe pour vérifier la disponibilité des sous-titres sur plusieurs sources
 */
class SubtitleChecker {
    /**
     * Crée une instance du vérificateur multi-sources
     *
     * @param {Object} options - Options de configuration
     * @param {string} [options.osApiKey] - Clé API OpenSubtitles
     * @param {string} [options.osUserAgent] - User-Agent OpenSubtitles
     * @param {string} [options.subdlApiKey] - Clé API SubDL
     */
    constructor(options = {}) {
        this.osApiKey = options.osApiKey;
        this.osUserAgent = options.osUserAgent || 'stremio-subtitles-fr v1.6';
        this.subdlApiKey = options.subdlApiKey;

        this.rateLimitedUntil = {
            opensubtitles: 0,
            subdl: 0
        };

        // Log des sources activées
        const sources = [];
        if (this.osApiKey) sources.push('OpenSubtitles');
        if (this.subdlApiKey) sources.push('SubDL');
        console.log(`[SubtitleChecker] Sources activées: ${sources.join(', ') || 'aucune'}`);
    }

    /**
     * Vérifie si une source est rate limitée
     *
     * @param {string} source - Nom de la source
     * @returns {boolean}
     */
    isRateLimited(source) {
        return Date.now() < (this.rateLimitedUntil[source] || 0);
    }

    /**
     * Définit le rate limit pour une source
     *
     * @param {string} source - Nom de la source
     * @param {number} [seconds] - Durée en secondes
     */
    setRateLimited(source, seconds = null) {
        const duration = seconds ? seconds * 1000 : DEFAULT_RATE_LIMIT_DURATION;
        this.rateLimitedUntil[source] = Date.now() + duration;
        console.log(`[SubtitleChecker] ${source} rate limité pour ${Math.ceil(duration / 60000)} minute(s)`);
    }

    /**
     * Vérifie la disponibilité des sous-titres sur toutes les sources
     *
     * @param {string} imdbId - ID IMDB
     * @param {string} type - Type ('movie' ou 'series')
     * @returns {Promise<Object>} { available, count, sources: { os, subdl } }
     */
    async checkAll(imdbId, type) {
        console.log(`[SubtitleChecker] Vérification ${imdbId} (${type})`);

        const promises = [];
        const sourceNames = [];

        // OpenSubtitles
        if (this.osApiKey && !this.isRateLimited('opensubtitles')) {
            promises.push(this._checkOpenSubtitles(imdbId, type));
            sourceNames.push('os');
        } else {
            promises.push(Promise.resolve(null));
            sourceNames.push('os');
        }

        // SubDL
        if (this.subdlApiKey && !this.isRateLimited('subdl')) {
            promises.push(this._checkSubDL(imdbId, type));
            sourceNames.push('subdl');
        } else {
            promises.push(Promise.resolve(null));
            sourceNames.push('subdl');
        }

        const results = await Promise.all(promises);

        // Compile les résultats
        const sources = {};
        let totalCount = 0;

        results.forEach((result, index) => {
            const name = sourceNames[index];
            sources[name] = result;
            if (result && result.count) {
                totalCount += result.count;
            }
        });

        const available = totalCount > 0;

        console.log(`[SubtitleChecker] ${imdbId}: ${available ? totalCount + ' sous-titre(s)' : 'aucun'}`);

        return {
            available,
            count: totalCount,
            sources
        };
    }

    /**
     * Vérifie sur OpenSubtitles
     *
     * @param {string} imdbId - ID IMDB
     * @param {string} type - Type
     * @returns {Promise<Object|null>}
     * @private
     */
    async _checkOpenSubtitles(imdbId, type) {
        try {
            const params = new URLSearchParams({ languages: 'fr' });

            if (type === 'movie') {
                params.append('imdb_id', imdbId);
                params.append('type', 'movie');
            } else {
                params.append('parent_imdb_id', imdbId);
            }

            const url = `https://api.opensubtitles.com/api/v1/subtitles?${params.toString()}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Api-Key': this.osApiKey,
                    'User-Agent': this.osUserAgent,
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After');
                this.setRateLimited('opensubtitles', retryAfter ? parseInt(retryAfter, 10) : null);
                return null;
            }

            if (!response.ok) return null;

            const data = await response.json();
            const count = data.total_count || (data.data ? data.data.length : 0);

            return { available: count > 0, count };
        } catch (error) {
            console.error(`[SubtitleChecker] OS erreur: ${error.message}`);
            return null;
        }
    }

    /**
     * Vérifie sur SubDL
     *
     * @param {string} imdbId - ID IMDB
     * @param {string} type - Type
     * @returns {Promise<Object|null>}
     * @private
     */
    async _checkSubDL(imdbId, type) {
        try {
            const params = new URLSearchParams({
                api_key: this.subdlApiKey,
                imdb_id: imdbId,
                languages: 'fr',
                type: type === 'series' ? 'tv' : 'movie'
            });

            const url = `https://api.subdl.com/api/v1/subtitles?${params.toString()}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.status === 429) {
                this.setRateLimited('subdl');
                return null;
            }

            if (!response.ok) return null;

            const data = await response.json();
            const count = data.subtitles ? data.subtitles.length : 0;

            return { available: count > 0, count };
        } catch (error) {
            console.error(`[SubtitleChecker] SubDL erreur: ${error.message}`);
            return null;
        }
    }
}

module.exports = SubtitleChecker;
