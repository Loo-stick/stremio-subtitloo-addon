/**
 * Client API SubDL
 *
 * Gère les interactions avec l'API REST SubDL
 * pour la recherche et le téléchargement de sous-titres.
 *
 * @module lib/subdl
 * @see https://subdl.com/api-doc
 */

const fetch = require('node-fetch');

const BASE_URL = 'https://api.subdl.com/api/v1';
const DOWNLOAD_BASE_URL = 'https://dl.subdl.com';

/** Nombre maximum de sous-titres à retourner */
const MAX_SUBTITLES = 15;

/**
 * Classe client pour l'API SubDL
 */
class SubDLClient {
    /**
     * Crée une instance du client SubDL
     *
     * @param {string} apiKey - Clé API SubDL
     */
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('API Key SubDL requise');
        }

        this.apiKey = apiKey;
    }

    /**
     * Effectue une requête HTTP vers l'API SubDL
     *
     * @param {string} endpoint - Endpoint API (ex: /subtitles)
     * @param {Object} params - Paramètres de requête
     * @returns {Promise<Object>} Réponse JSON de l'API
     * @private
     */
    async _request(endpoint, params = {}) {
        const url = new URL(`${BASE_URL}${endpoint}`);

        // Ajoute la clé API
        url.searchParams.append('api_key', this.apiKey);

        // Ajoute les autres paramètres
        Object.keys(params).forEach(key => {
            if (params[key] !== undefined && params[key] !== null) {
                url.searchParams.append(key, params[key]);
            }
        });

        try {
            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Erreur API SubDL: ${response.status} - ${errorBody}`);
            }

            const data = await response.json();

            if (data.status === false) {
                throw new Error(`Erreur SubDL: ${data.error || 'Erreur inconnue'}`);
            }

            return data;
        } catch (error) {
            console.error(`[SubDL] Erreur requête ${endpoint}:`, error.message);
            throw error;
        }
    }

    /**
     * Recherche des sous-titres français pour un contenu
     *
     * @param {Object} options - Options de recherche
     * @param {string} options.imdbId - ID IMDB (format: tt1234567)
     * @param {string} options.type - Type de contenu: 'movie' ou 'series'
     * @param {number} [options.season] - Numéro de saison (pour les séries)
     * @param {number} [options.episode] - Numéro d'épisode (pour les séries)
     * @returns {Promise<Array>} Liste des sous-titres trouvés
     */
    async searchSubtitles({ imdbId, type, season, episode }) {
        console.log(`[SubDL] Recherche sous-titres FR pour ${imdbId} (${type})`);

        if (season && episode) {
            console.log(`[SubDL] Saison ${season}, Episode ${episode}`);
        }

        const params = {
            imdb_id: imdbId,
            languages: 'fr',
            subs_per_page: MAX_SUBTITLES,
            type: type === 'series' ? 'tv' : 'movie'
        };

        // Ajoute les paramètres de série si nécessaire
        if (type === 'series' || type === 'episode') {
            params.type = 'tv';
            if (season) params.season_number = season;
            if (episode) params.episode_number = episode;
        }

        try {
            const response = await this._request('/subtitles', params);

            if (!response.subtitles || response.subtitles.length === 0) {
                console.log(`[SubDL] Aucun sous-titre trouvé pour ${imdbId}`);
                return [];
            }

            console.log(`[SubDL] ${response.subtitles.length} sous-titre(s) trouvé(s) pour ${imdbId}`);

            return response.subtitles.slice(0, MAX_SUBTITLES);
        } catch (error) {
            console.error(`[SubDL] Erreur recherche ${imdbId}:`, error.message);
            return [];
        }
    }

    /**
     * Formate les sous-titres SubDL pour Stremio
     *
     * @param {Array} subtitles - Liste des sous-titres SubDL
     * @returns {Array} Liste formatée pour Stremio
     */
    formatForStremio(subtitles) {
        const formatted = [];

        for (const sub of subtitles) {
            try {
                // Construit l'URL de téléchargement
                // Format: https://dl.subdl.com + url du sous-titre
                const downloadUrl = sub.url ? `${DOWNLOAD_BASE_URL}${sub.url}` : null;

                if (!downloadUrl) continue;

                const releaseName = sub.release_name || sub.name || 'Unknown';
                const isHearingImpaired = sub.hi ? ' [HI]' : '';

                // ID descriptif (au cas où affiché dans Variants)
                const variantId = `[SubDL] ${releaseName}${isHearingImpaired}`;

                formatted.push({
                    id: variantId,
                    url: downloadUrl,
                    lang: 'fre',
                    // Métadonnées internes pour le scoring
                    _release: releaseName
                });

            } catch (error) {
                console.error('[SubDL] Erreur formatage sous-titre:', error.message);
                continue;
            }
        }

        console.log(`[SubDL] ${formatted.length} sous-titre(s) formaté(s) pour Stremio`);
        return formatted;
    }
}

module.exports = SubDLClient;
