/**
 * Client API OpenSubtitles
 *
 * Gère les interactions avec l'API REST OpenSubtitles v1
 * pour la recherche et le téléchargement de sous-titres.
 *
 * Utilise un système de proxy pour éviter le rate limiting:
 * - La recherche retourne des URLs de proxy locales
 * - Le téléchargement réel se fait uniquement quand l'utilisateur clique
 *
 * @module lib/opensubtitles
 */

const fetch = require('node-fetch');

const BASE_URL = 'https://api.opensubtitles.com/api/v1';

/** Nombre maximum de sous-titres à retourner (réduit pour limiter les requêtes) */
const MAX_SUBTITLES = 5;

/** Durée de vie du cache des liens download (3 heures en ms) */
const CACHE_TTL = 3 * 60 * 60 * 1000;

/**
 * Cache simple en mémoire avec TTL
 */
class SimpleCache {
    constructor() {
        this.cache = new Map();
    }

    /**
     * Récupère une valeur du cache
     *
     * @param {string} key - Clé du cache
     * @returns {*} Valeur ou undefined si expirée/inexistante
     */
    get(key) {
        const item = this.cache.get(key);
        if (!item) return undefined;

        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return undefined;
        }

        return item.value;
    }

    /**
     * Stocke une valeur dans le cache
     *
     * @param {string} key - Clé du cache
     * @param {*} value - Valeur à stocker
     * @param {number} ttl - Durée de vie en ms
     */
    set(key, value, ttl = CACHE_TTL) {
        this.cache.set(key, {
            value,
            expiry: Date.now() + ttl
        });
    }

    /**
     * Nettoie les entrées expirées
     */
    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiry) {
                this.cache.delete(key);
            }
        }
    }
}

/**
 * Erreur de rate limiting
 */
class RateLimitError extends Error {
    constructor(retryAfter = null) {
        super('Rate limit exceeded');
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}

/**
 * Classe client pour l'API OpenSubtitles
 */
class OpenSubtitlesClient {
    /**
     * Crée une instance du client OpenSubtitles
     *
     * @param {string} apiKey - Clé API OpenSubtitles
     * @param {string} userAgent - User-Agent personnalisé (obligatoire)
     */
    constructor(apiKey, userAgent) {
        if (!apiKey) {
            throw new Error('API Key OpenSubtitles requise');
        }
        if (!userAgent) {
            throw new Error('User-Agent requis');
        }

        this.apiKey = apiKey;
        this.userAgent = userAgent;
        this.downloadCache = new SimpleCache();
        this.pendingDownloads = new Map(); // Dédup in-flight

        // Nettoyage périodique du cache (toutes les 30 min)
        setInterval(() => this.downloadCache.cleanup(), 30 * 60 * 1000);
    }

    /**
     * Effectue une requête HTTP vers l'API OpenSubtitles
     *
     * @param {string} endpoint - Endpoint API (ex: /subtitles)
     * @param {Object} params - Paramètres de requête
     * @returns {Promise<Object>} Réponse JSON de l'API
     * @throws {RateLimitError} Si rate limité
     * @private
     */
    async _request(endpoint, params = {}) {
        const url = new URL(`${BASE_URL}${endpoint}`);

        Object.keys(params).forEach(key => {
            if (params[key] !== undefined && params[key] !== null) {
                url.searchParams.append(key, params[key]);
            }
        });

        const headers = {
            'Api-Key': this.apiKey,
            'User-Agent': this.userAgent,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers
        });

        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            console.error(`[OpenSubtitles] ⚠️ Rate limit atteint! Retry-After: ${retryAfter || 'non spécifié'}s`);
            throw new RateLimitError(retryAfter);
        }

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Erreur API: ${response.status} - ${errorBody}`);
        }

        return await response.json();
    }

    /**
     * Recherche des sous-titres français pour un contenu
     *
     * @param {Object} options - Options de recherche
     * @param {string} options.imdbId - ID IMDB (format: tt1234567)
     * @param {string} options.type - Type de contenu: 'movie' ou 'episode'
     * @param {number} [options.season] - Numéro de saison (pour les séries)
     * @param {number} [options.episode] - Numéro d'épisode (pour les séries)
     * @param {string} [options.videoHash] - Hash OpenSubtitles du fichier vidéo
     * @param {number} [options.videoSize] - Taille du fichier en bytes
     * @returns {Promise<Object>} Résultat { subtitles, hashMatches }
     */
    async searchSubtitles({ imdbId, type, season, episode, videoHash, videoSize }) {
        console.log(`[OpenSubtitles] Recherche sous-titres FR pour ${imdbId} (${type})`);

        if (season && episode) {
            console.log(`[OpenSubtitles] Saison ${season}, Episode ${episode}`);
        }

        const result = {
            subtitles: [],
            hashMatches: new Set() // IDs des sous-titres matchés par hash
        };

        // Recherche par hash si disponible (prioritaire)
        if (videoHash && videoSize) {
            console.log(`[OpenSubtitles] Recherche par hash: ${videoHash} (${videoSize} bytes)`);
            try {
                const hashResult = await this._searchByHash(videoHash, videoSize);
                if (hashResult.length > 0) {
                    console.log(`[OpenSubtitles] ${hashResult.length} résultat(s) par hash (match parfait)`);
                    for (const sub of hashResult) {
                        result.hashMatches.add(sub.id);
                    }
                    result.subtitles.push(...hashResult);
                }
            } catch (error) {
                console.error(`[OpenSubtitles] Erreur recherche hash:`, error.message);
            }
        }

        // Recherche classique par IMDB (complémentaire)
        const params = {
            imdb_id: imdbId,
            languages: 'fr',
            order_by: 'download_count',
            order_direction: 'desc'
        };

        if (type === 'series' || type === 'episode') {
            params.type = 'episode';
            if (season) params.season_number = season;
            if (episode) params.episode_number = episode;
        } else {
            params.type = 'movie';
        }

        try {
            const response = await this._request('/subtitles', params);

            if (response.data && response.data.length > 0) {
                // Filtre les doublons (déjà trouvés par hash)
                const newSubs = response.data.filter(sub => !result.hashMatches.has(sub.id));
                console.log(`[OpenSubtitles] ${response.data.length} résultat(s) par IMDB, ${newSubs.length} nouveaux`);
                result.subtitles.push(...newSubs);
            } else {
                console.log(`[OpenSubtitles] Aucun sous-titre trouvé par IMDB pour ${imdbId}`);
            }
        } catch (error) {
            if (error instanceof RateLimitError) {
                console.error('[OpenSubtitles] Recherche IMDB abandonnée (rate limit)');
            } else {
                console.error(`[OpenSubtitles] Erreur recherche IMDB:`, error.message);
            }
        }

        console.log(`[OpenSubtitles] Total: ${result.subtitles.length} sous-titre(s), limite à ${MAX_SUBTITLES}`);
        result.subtitles = result.subtitles.slice(0, MAX_SUBTITLES);

        return result;
    }

    /**
     * Recherche par hash OpenSubtitles (match exact du fichier)
     *
     * @param {string} movieHash - Hash du fichier vidéo
     * @param {number} movieSize - Taille du fichier en bytes
     * @returns {Promise<Array>} Sous-titres correspondants
     * @private
     */
    async _searchByHash(movieHash, movieSize) {
        const params = {
            moviehash: movieHash,
            languages: 'fr'
        };

        const response = await this._request('/subtitles', params);

        if (!response.data || response.data.length === 0) {
            return [];
        }

        return response.data;
    }

    /**
     * Récupère le lien de téléchargement d'un sous-titre (appelé par le proxy)
     * Utilise un mécanisme de dédup in-flight pour éviter les appels simultanés
     *
     * @param {number} fileId - ID du fichier de sous-titre
     * @returns {Promise<string|null>} URL de téléchargement ou null en cas d'erreur
     * @throws {RateLimitError} Si rate limité
     */
    async getDownloadLink(fileId) {
        // Vérifie le cache d'abord
        const cached = this.downloadCache.get(fileId);
        if (cached) {
            console.log(`[OpenSubtitles] Cache hit pour file_id: ${fileId}`);
            return cached;
        }

        // Dédup in-flight : si une requête est déjà en cours, attendre la même Promise
        if (this.pendingDownloads.has(fileId)) {
            console.log(`[OpenSubtitles] In-flight hit pour file_id: ${fileId}`);
            return this.pendingDownloads.get(fileId);
        }

        // Crée la Promise et l'enregistre
        const downloadPromise = this._fetchDownloadLink(fileId);
        this.pendingDownloads.set(fileId, downloadPromise);

        try {
            const result = await downloadPromise;
            return result;
        } finally {
            // Nettoie le pending une fois terminé
            this.pendingDownloads.delete(fileId);
        }
    }

    /**
     * Effectue réellement l'appel /download
     *
     * @param {number} fileId - ID du fichier
     * @returns {Promise<string|null>} URL de téléchargement
     * @private
     */
    async _fetchDownloadLink(fileId) {
        console.log(`[OpenSubtitles] Récupération lien download pour file_id: ${fileId}`);

        const response = await fetch(`${BASE_URL}/download`, {
            method: 'POST',
            headers: {
                'Api-Key': this.apiKey,
                'User-Agent': this.userAgent,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ file_id: fileId })
        });

        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            console.error(`[OpenSubtitles] ⚠️ Rate limit sur download! Retry-After: ${retryAfter || 'non spécifié'}s`);
            throw new RateLimitError(retryAfter);
        }

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Erreur download: ${response.status} - ${errorBody}`);
        }

        const data = await response.json();

        if (data.link) {
            // Cache le lien pour 3h
            this.downloadCache.set(fileId, data.link);
            console.log(`[OpenSubtitles] Lien obtenu et caché pour file_id: ${fileId}`);
            return data.link;
        }

        return null;
    }

    /**
     * Formate les sous-titres OpenSubtitles pour Stremio
     * Retourne des URLs de proxy au lieu d'appeler /download
     *
     * @param {Object} searchResult - Résultat de searchSubtitles { subtitles, hashMatches }
     * @param {string} addonUrl - URL publique de l'addon pour le proxy
     * @returns {Array} Liste formatée pour Stremio avec infos de matching
     */
    formatForStremio(searchResult, addonUrl) {
        const formatted = [];
        const { subtitles, hashMatches } = searchResult;

        for (const sub of subtitles) {
            try {
                const attributes = sub.attributes;
                const files = attributes.files || [];

                if (files.length === 0) continue;

                const file = files[0];
                const fileId = file.file_id;

                // URL de proxy au lieu de l'URL directe
                const proxyUrl = `${addonUrl}/proxy/os/${fileId}`;

                const releaseInfo = attributes.release || 'Unknown';
                const isHashMatch = hashMatches.has(sub.id);

                // ID descriptif (au cas où affiché dans Variants)
                const matchBadge = isHashMatch ? '✓ ' : '';
                const variantId = `[OS] ${matchBadge}${releaseInfo}`;

                formatted.push({
                    id: variantId,
                    url: proxyUrl,
                    lang: 'fre',
                    // Métadonnées internes pour le scoring
                    _release: releaseInfo,
                    _hashMatch: isHashMatch
                });

            } catch (error) {
                console.error('[OpenSubtitles] Erreur formatage sous-titre:', error.message);
                continue;
            }
        }

        console.log(`[OpenSubtitles] ${formatted.length} sous-titre(s) formaté(s) pour Stremio (via proxy)`);
        return formatted;
    }
}

module.exports = OpenSubtitlesClient;
module.exports.RateLimitError = RateLimitError;
