/**
 * Client API Cinemeta
 *
 * Récupère les métadonnées des films et séries depuis l'addon Cinemeta de Stremio.
 * Cinemeta est l'addon officiel qui fournit les métadonnées IMDB.
 *
 * @module lib/cinemeta
 */

const fetch = require('node-fetch');

/** URL de base de l'API Cinemeta v3 */
const CINEMETA_BASE_URL = 'https://v3-cinemeta.strem.io';

/** Timeout des requêtes en ms */
const REQUEST_TIMEOUT = 5000;

/**
 * Classe client pour l'API Cinemeta
 */
class CinemetaClient {
    /**
     * Crée une instance du client Cinemeta
     */
    constructor() {
        this.baseUrl = CINEMETA_BASE_URL;
    }

    /**
     * Récupère les métadonnées d'un film ou d'une série
     *
     * @param {string} type - Type de contenu ('movie' ou 'series')
     * @param {string} imdbId - ID IMDB (format: tt1234567)
     * @returns {Promise<Object|null>} Objet meta Stremio ou null en cas d'erreur
     */
    async getMeta(type, imdbId) {
        const url = `${this.baseUrl}/meta/${type}/${imdbId}.json`;

        console.log(`[Cinemeta] Récupération meta pour ${type}/${imdbId}`);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                if (response.status === 404) {
                    console.log(`[Cinemeta] Contenu non trouvé: ${imdbId}`);
                    return null;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!data || !data.meta) {
                console.log(`[Cinemeta] Réponse invalide pour ${imdbId}`);
                return null;
            }

            console.log(`[Cinemeta] Meta récupérée: "${data.meta.name}"`);
            return data.meta;

        } catch (error) {
            if (error.name === 'AbortError') {
                console.error(`[Cinemeta] Timeout pour ${imdbId}`);
            } else {
                console.error(`[Cinemeta] Erreur: ${error.message}`);
            }
            return null;
        }
    }
}

module.exports = CinemetaClient;
