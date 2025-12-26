/**
 * Client API YIFY Subtitles
 *
 * Gère les interactions avec l'API YIFY Subtitles
 * pour la recherche de sous-titres de films.
 *
 * Note: YIFY ne supporte que les films, pas les séries.
 *
 * @module lib/yify
 * @see https://github.com/vankasteelj/yifysubtitles-api
 */

const yifysubtitles = require('yifysubtitles-api');

/** Nombre maximum de sous-titres à retourner */
const MAX_SUBTITLES = 15;

/**
 * Classe client pour l'API YIFY Subtitles
 */
class YIFYClient {
    /**
     * Crée une instance du client YIFY
     * Note: YIFY ne nécessite pas de clé API
     */
    constructor() {
        console.log('[YIFY] Client initialisé (pas de clé API requise)');
    }

    /**
     * Recherche des sous-titres français pour un film
     *
     * @param {Object} options - Options de recherche
     * @param {string} options.imdbId - ID IMDB (format: tt1234567)
     * @param {string} options.type - Type de contenu (seuls les 'movie' sont supportés)
     * @returns {Promise<Array>} Liste des sous-titres trouvés
     */
    async searchSubtitles({ imdbId, type }) {
        // YIFY ne supporte que les films
        if (type === 'series') {
            console.log('[YIFY] Type série non supporté, skip');
            return [];
        }

        console.log(`[YIFY] Recherche sous-titres FR pour ${imdbId}`);

        try {
            const results = await yifysubtitles.search({ imdbid: imdbId });

            if (!results) {
                console.log(`[YIFY] Aucun résultat pour ${imdbId}`);
                return [];
            }

            // Récupère les sous-titres français
            const frenchSubs = results.fr || results.french || [];

            if (frenchSubs.length === 0) {
                console.log(`[YIFY] Aucun sous-titre français pour ${imdbId}`);
                return [];
            }

            console.log(`[YIFY] ${frenchSubs.length} sous-titre(s) français trouvé(s) pour ${imdbId}`);

            // Trie par rating et limite
            const sorted = frenchSubs
                .sort((a, b) => (b.rating || 0) - (a.rating || 0))
                .slice(0, MAX_SUBTITLES);

            return sorted;
        } catch (error) {
            console.error(`[YIFY] Erreur recherche ${imdbId}:`, error.message);
            return [];
        }
    }

    /**
     * Formate les sous-titres YIFY pour Stremio
     *
     * @param {Array} subtitles - Liste des sous-titres YIFY
     * @returns {Array} Liste formatée pour Stremio
     */
    formatForStremio(subtitles) {
        const formatted = [];

        for (const sub of subtitles) {
            try {
                if (!sub.url) continue;

                const release = sub.release || 'Unknown';
                const rating = sub.rating || 0;
                const isHearingImpaired = sub.hi ? ' [HI]' : '';

                formatted.push({
                    id: `yify-${sub.id || Date.now()}`,
                    url: sub.url,
                    lang: 'fre',
                    SubEncoding: 'UTF-8',
                    SubFormat: 'srt',
                    SubFileName: `${release}.srt`,
                    SubRating: rating,
                    // Informations affichées dans Stremio
                    SubDisplayTitle: `[YIFY] [★${rating}] ${release}${isHearingImpaired}`,
                    SubAuthorComment: sub.langName || 'French',
                    // Métadonnées internes pour le scoring
                    _release: release
                });

            } catch (error) {
                console.error('[YIFY] Erreur formatage sous-titre:', error.message);
                continue;
            }
        }

        console.log(`[YIFY] ${formatted.length} sous-titre(s) formaté(s) pour Stremio`);
        return formatted;
    }
}

module.exports = YIFYClient;
