import { hasAccess } from "./access_checking";
import { CardInclusions, Decklists, DecksByInvestigator, InvestigatorCounts } from "./recommendations.types";
import { Id } from "./stolen.types";
import { Index, Recommendation, RecommendationAnalysisAlgorithm, RecommendationRequest } from "./index.types";

type DBAccessor = (query: string, values?: any) => Promise<any>;

function percentileRank(values: number[], value: number) {
    const sortedValues = values.slice().sort((a, b) => a - b);
    const firstGreater = sortedValues.findIndex((v) => v > value);
    if (firstGreater === -1) {
        return 100;
    }
    const nGreater = sortedValues.length - firstGreater;
    return 100 - (nGreater / sortedValues.length) * 100;
}

export function dateToMonth(date: Date) {
    return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

async function findInclusionsOfCardForInvestigator(
    investigatorCode: string,
    cardCode: string,
    includeSideDeck: boolean,
    dateRange: [Date, Date],
    validDecks: Record<Id, 1>,
    db: DBAccessor
): Promise<number> {
    const query = `
    SELECT DISTINCT d.id
    FROM decklists_new d
    WHERE d.investigator_code = $1
      AND d.date_creation BETWEEN $2 AND $3
      AND (
          d.slots ? $4
          ${includeSideDeck ? `OR d.side_slots ? $4` : ''}
      )
`;
    const params = [investigatorCode, dateRange[0], dateRange[1], cardCode];
    const res = await db(query, params);
    return res.filter((row: any) => validDecks[row.id]).length;
}

async function getNDecksForOtherInvestigators(investigatorCode: string, dateRange: [Date, Date], db: DBAccessor) {
    const query = `
    SELECT d.investigator_code, COUNT(DISTINCT d.id) AS deck_count
    FROM decklists d
    WHERE d.investigator_code != $1
        AND d.date_creation BETWEEN $2 AND $3
    GROUP BY d.investigator_code`;
    const params = [investigatorCode, dateRange[0], dateRange[1]];
    return await db(query, params);
}

async function getNDecksForOtherInvestigatorsIncludingCard(
    investigatorCode: string,
    cardCode: string,
    dateRange: [Date, Date],
    includeSideDeck: boolean,
    db: DBAccessor
) {
    const query = `
    SELECT d.investigator_code, COUNT(DISTINCT d.id) AS deck_count
    FROM decklists_new d
    WHERE d.investigator_code != $1
      AND d.date_creation BETWEEN $2 AND $3
      AND (
          d.slots ? $4
          ${includeSideDeck ? `OR d.side_slots ? $4` : ''}
      )
    GROUP BY d.investigator_code
`;
    const params = [investigatorCode, dateRange[0], dateRange[1], cardCode];
    return await db(query, params);
}

async function inclusionPercentagesForOtherInvestigators(
    cardCode: string,
    investigatorCode: string,
    includeSideDeck: boolean,
    dateRange: [Date, Date],
    db: DBAccessor
) {
    const ret: Record<string, number> = {};
    const query = `
    SELECT dc.investigator_code,
           dc.deck_count,
           COALESCE(cs.deck_count_with_card, 0) AS deck_count_with_card
    FROM investigator_deck_counts dc
    LEFT JOIN card_inclusion_counts cs ON dc.investigator_code = cs.investigator_code 
                                         AND dc.creation_month = cs.creation_month 
                                         AND cs.card_code = $4
    WHERE dc.investigator_code != $1
      AND dc.creation_month BETWEEN date_trunc('month', $2::DATE) AND date_trunc('month', $3::DATE)
    GROUP BY dc.investigator_code, dc.deck_count, cs.deck_count_with_card
`;

const params = [investigatorCode, dateRange[0], dateRange[1], cardCode];
    const results = await db(query, params);
    for (const row of results) {
        ret[row.investigator_code] = row.deck_count_with_card / row.deck_count * 100;
    }

    return ret;
}

export async function getInvestigatorName(investigatorCode: string, db: DBAccessor): Promise<string> {
    const results = await db('SELECT name FROM cards WHERE code = $1', [investigatorCode]);
    return results[0].name;
}

export async function computeRecommendationForCard(
    cardCode: string,
    investigatorCode: string,
    includeSideDeck: boolean,
    analysisAlgorithm: RecommendationAnalysisAlgorithm,
    dateRange: [Date, Date],
    validDecks: Record<Id, 1>,
    db: DBAccessor
): Promise<Recommendation | undefined> {
    const investigatorName = await getInvestigatorName(investigatorCode, db);
    const nInclusionsForInvestigator = await findInclusionsOfCardForInvestigator(
        investigatorCode,
        cardCode,
        includeSideDeck,
        dateRange,
        validDecks,
        db
    );

    const inclusionPercentage = (nInclusionsForInvestigator / Object.keys(validDecks).length) * 100;

    // Don't supply a recommendation if the inclusion percentage is too low
    // This filters out anomalies like cards that are barely ever used showing high in the percentile ranks
    if (inclusionPercentage < 5) {
        return undefined;
    }

    if (analysisAlgorithm === "percentile rank") {
        const otherInclusions = await inclusionPercentagesForOtherInvestigators(
            cardCode,
            investigatorCode,
            includeSideDeck,
            dateRange,
            db
        );

        // If no other investigators have access to this card, we won't include it
        if (Object.keys(otherInclusions).length === 0) {
            return undefined;
        }
        const rank = percentileRank(
            Object.values(otherInclusions).concat([inclusionPercentage]),
            inclusionPercentage
        );
        return {
            card_code: cardCode,
            recommendation: Math.floor(rank),
            ordering: rank, // Put cards with a higher float rank first, even though we display the integer rank
            explanation: `The percentile rank of ${investigatorName}'s use of this card compared to other investigators is ${Math.floor(rank)}`,
        };
    }
    else if (analysisAlgorithm === "absolute percentage") {
        return {
            card_code: cardCode,
            recommendation: inclusionPercentage,
            ordering: inclusionPercentage,
            explanation: `${inclusionPercentage.toFixed(2)}% of ${investigatorName} decks (${nInclusionsForInvestigator}/${Object.keys(validDecks).length}) use this card`,
        };
    }
}

export function firstDayOfNextMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

async function validDecksForInvestigator(
    investigatorCode: string,
    includeSideDeck: boolean,
    dateRange: [Date, Date],
    requiredCards: string[],
    excludedCards: string[],
    db: DBAccessor,
): Promise<Record<Id, 1>> {
    const requiredPlaceholders = requiredCards.length > 0 ? requiredCards.map((_, i) => `$${i + 1}`).join(', ') : null;
    const excludedPlaceholders = excludedCards.length > 0 ? excludedCards.map((_, i) => `$${i + 1 + requiredCards.length}`).join(', ') : null;

    let query = `
        SELECT d.id
        FROM decklists d
        ${requiredPlaceholders ? `
        JOIN (
            SELECT id, card_code
            FROM decklist_slots
            WHERE card_code IN (${requiredPlaceholders})
            ${includeSideDeck ? `
            UNION ALL
            SELECT id, card_code
            FROM decklist_side_slots
            WHERE card_code IN (${requiredPlaceholders})
            ` : ''}
        ) ds ON d.id = ds.id
        ` : ''}
        WHERE d.date_creation BETWEEN $${requiredCards.length + excludedCards.length + 1} AND $${requiredCards.length + excludedCards.length + 2}
          AND d.investigator_code = $${requiredCards.length + excludedCards.length + 3}
          ${excludedPlaceholders ? `
          AND NOT EXISTS (
              SELECT 1
              FROM decklist_slots ds2
              WHERE ds2.id = d.id
                AND ds2.card_code IN (${excludedPlaceholders})
          )
          ${includeSideDeck ? `
          AND NOT EXISTS (
              SELECT 1
              FROM decklist_side_slots sds2
              WHERE sds2.id = d.id
                AND sds2.card_code IN (${excludedPlaceholders})
          `: ''}
          )
          ` : ''}
        ${requiredPlaceholders ? `
        GROUP BY d.id
        HAVING COUNT(DISTINCT ds.card_code) = $${requiredCards.length + excludedCards.length + 4}
        ` : ''}
    `;

    const params: (string | Date | number)[] = [
        ...requiredCards,
    ];

    if (includeSideDeck) {
        params.push(...requiredCards);
    }

    params.push(
        dateRange[0],
        dateRange[1],
        investigatorCode);

    if (excludedPlaceholders) {
        params.push(...excludedCards);
        if (includeSideDeck) {
            params.push(...excludedCards);
        }
    }

    if (requiredPlaceholders) {
        params.push(requiredCards.length);
    }

    const results = await db(query, params);
    return results.reduce((acc: Record<Id, 1>, row: any) => {
        acc[row.id] = 1;
        return acc;
    }, {});
}

export async function getRecommendations(
    request: RecommendationRequest,
    db: DBAccessor,
) {
    const dateRange: [Date, Date] = [new Date(request.date_range[0]), firstDayOfNextMonth(new Date(request.date_range[1]))];
    const validDecks = await validDecksForInvestigator(
        request.investigator_code,
        request.analyze_side_decks,
        dateRange,
        request.required_cards,
        request.excluded_cards,
        db
    );

    const recommendationPromises = request.cards_to_recommend.map((code) => {
        return computeRecommendationForCard(
            code,
            request.investigator_code,
            request.analyze_side_decks,
            request.analysis_algorithm,
            dateRange,
            validDecks,
            db
        );
    });
    return (await Promise.all(recommendationPromises)).filter((recommendation) => recommendation !== undefined);
}
