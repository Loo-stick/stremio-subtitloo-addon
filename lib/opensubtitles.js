/**
 * Client API OpenSubtitles
 *
 * Gère les interactions avec l'API REST OpenSubtitles v1
 * pour la recherche et le téléchargement de sous-titres.
 *
 * @module lib/opensubtitles
 */

const fetch = require('node-fetch');

const BASE_URL = 'https://api.opensubtitles.com/api/v1';

/** Délai de retry en cas de rate limiting (en ms) */
const RATE_LIMIT_DELAY = 1000;

/** Nombre maximum de sous-titres à retourner */
const MAX_SUBTITLES = 15;

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
    }

    /**
     * Effectue une requête HTTP vers l'API OpenSubtitles
     *
     * @param {string} endpoint - Endpoint API (ex: /subtitles)
     * @param {Object} params - Paramètres de requête
     * @param {number} retryCount - Nombre de tentatives restantes en cas de rate limit
     * @returns {Promise<Object>} Réponse JSON de l'API
     * @private
     */
    async _request(endpoint, params = {}, retryCount = 3) {
        const url = new URL(`${BASE_URL}${endpoint}`);

        // Ajoute les paramètres à l'URL
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

        try {
            const response = await fetch(url.toString(), {
                method: 'GET',
                headers
            });

            // Gestion du rate limiting (429)
            if (response.status === 429) {
                if (retryCount > 0) {
                    console.log(`[OpenSubtitles] Rate limit atteint, retry dans ${RATE_LIMIT_DELAY}ms...`);
                    await this._sleep(RATE_LIMIT_DELAY);
                    return this._request(endpoint, params, retryCount - 1);
                }
                throw new Error('Rate limit dépassé après plusieurs tentatives');
            }

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Erreur API OpenSubtitles: ${response.status} - ${errorBody}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`[OpenSubtitles] Erreur requête ${endpoint}:`, error.message);
            throw error;
        }
    }

    /**
     * Fonction utilitaire pour créer un délai
     *
     * @param {number} ms - Délai en millisecondes
     * @returns {Promise<void>}
     * @private
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Recherche des sous-titres français pour un contenu
     *
     * @param {Object} options - Options de recherche
     * @param {string} options.imdbId - ID IMDB (format: tt1234567)
     * @param {string} options.type - Type de contenu: 'movie' ou 'episode'
     * @param {number} [options.season] - Numéro de saison (pour les séries)
     * @param {number} [options.episode] - Numéro d'épisode (pour les séries)
     * @returns {Promise<Array>} Liste des sous-titres trouvés
     */
    async searchSubtitles({ imdbId, type, season, episode }) {
        console.log(`[OpenSubtitles] Recherche sous-titres FR pour ${imdbId} (${type})`);

        if (season && episode) {
            console.log(`[OpenSubtitles] Saison ${season}, Episode ${episode}`);
        }

        const params = {
            imdb_id: imdbId,
            languages: 'fr',
            order_by: 'download_count',
            order_direction: 'desc'
        };

        // Ajoute les paramètres de série si nécessaire
        if (type === 'series' || type === 'episode') {
            params.type = 'episode';
            if (season) params.season_number = season;
            if (episode) params.episode_number = episode;
        } else {
            params.type = 'movie';
        }

        try {
            const response = await this._request('/subtitles', params);

            if (!response.data || response.data.length === 0) {
                console.log(`[OpenSubtitles] Aucun sous-titre trouvé pour ${imdbId}`);
                return [];
            }

            console.log(`[OpenSubtitles] ${response.data.length} sous-titre(s) trouvé(s) pour ${imdbId}`);

            // Limite le nombre de résultats et formate
            return response.data.slice(0, MAX_SUBTITLES);
        } catch (error) {
            console.error(`[OpenSubtitles] Erreur recherche ${imdbId}:`, error.message);
            return [];
        }
    }

    /**
     * Récupère le lien de téléchargement d'un sous-titre
     *
     * @param {number} fileId - ID du fichier de sous-titre
     * @returns {Promise<string|null>} URL de téléchargement ou null en cas d'erreur
     */
    async getDownloadLink(fileId) {
        console.log(`[OpenSubtitles] Récupération lien download pour file_id: ${fileId}`);

        try {
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

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Erreur download: ${response.status} - ${errorBody}`);
            }

            const data = await response.json();

            if (data.link) {
                console.log(`[OpenSubtitles] Lien obtenu pour file_id ${fileId}`);
                return data.link;
            }

            return null;
        } catch (error) {
            console.error(`[OpenSubtitles] Erreur récupération lien ${fileId}:`, error.message);
            return null;
        }
    }

    /**
     * Formate les sous-titres OpenSubtitles pour Stremio
     *
     * @param {Array} subtitles - Liste des sous-titres OpenSubtitles
     * @returns {Promise<Array>} Liste formatée pour Stremio
     */
    async formatForStremio(subtitles) {
        const formatted = [];

        for (const sub of subtitles) {
            try {
                const attributes = sub.attributes;
                const files = attributes.files || [];

                if (files.length === 0) continue;

                // Prend le premier fichier disponible
                const file = files[0];
                const fileId = file.file_id;

                // Récupère le lien de téléchargement
                const downloadUrl = await this.getDownloadLink(fileId);

                if (!downloadUrl) continue;

                // Construit le label du sous-titre
                const releaseInfo = attributes.release || 'Unknown';
                const downloadCount = attributes.download_count || 0;
                const uploaderName = attributes.uploader?.name || 'Anonymous';

                formatted.push({
                    id: `opensubtitles-${fileId}`,
                    url: downloadUrl,
                    lang: 'fre',
                    SubEncoding: attributes.encoding || 'UTF-8',
                    SubFormat: file.file_name?.split('.').pop() || 'srt',
                    SubFileName: file.file_name || `subtitle_${fileId}.srt`,
                    SubDownloadsCnt: downloadCount,
                    SubRating: attributes.ratings || 0,
                    // Informations affichées dans Stremio
                    // Format: [Downloads] Release - Uploader
                    SubDisplayTitle: `[${downloadCount}↓] ${releaseInfo}`,
                    SubAuthorComment: `Uploadé par ${uploaderName}`
                });

            } catch (error) {
                console.error('[OpenSubtitles] Erreur formatage sous-titre:', error.message);
                continue;
            }
        }

        console.log(`[OpenSubtitles] ${formatted.length} sous-titre(s) formaté(s) pour Stremio`);
        return formatted;
    }
}

module.exports = OpenSubtitlesClient;
