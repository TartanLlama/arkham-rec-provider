import { RecommendationRequest } from "./index.types";
import { IDatabase, IMain, ITask } from "pg-promise";

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

type InclusionCount = {
    card_code: string;
    canonical_investigator_code: string;
    decks_analyzed: number;
    decks_with_card: number;
};

async function computeInclusionPercentagesForInvestigator(
    investigatorCode: string,
    includeSideDeck: boolean,
    dateRange: [Date, Date],
    requiredCards: string[],
    cardsToRecommend: string,
    storeToTable: boolean,
    db: ITask<{}>
): Promise<InclusionCount[]> {
    if (storeToTable) {
        await db.none(`
            CREATE TEMP TABLE percentages_for_investigator (
                card_code VARCHAR(6),
                canonical_investigator_code VARCHAR(13),
                decks_analyzed INT,
                decks_with_card INT
            ) ON COMMIT DROP;
        `);
    }

    const query = `
    ${storeToTable ? `
        INSERT INTO percentages_for_investigator (card_code, canonical_investigator_code, decks_analyzed, decks_with_card)
        ` : ''}
    WITH filtered_decks AS (
        SELECT id
        FROM decklists
        WHERE date_creation BETWEEN $1 AND $2
            AND canonical_investigator_code = $3
            ${requiredCards.length ? `
                AND id IN (
                    SELECT decklist_id
                    FROM (
                        SELECT decklist_id, card_code
                        FROM decklist_slots
                        WHERE card_code = ANY($4::text[])
                        ${includeSideDeck ? `
                        UNION ALL
                        SELECT decklist_id, card_code
                        FROM decklist_side_slots
                        WHERE card_code = ANY($4::text[])
                        ` : ''}
                    ) combined_slots
                    GROUP BY decklist_id
                    HAVING COUNT(DISTINCT card_code) = ${requiredCards.length}
                )
            ` : ''}
    ),
    slots AS ( 
        SELECT ds.decklist_id, ds.card_code 
        FROM decklist_slots ds 
        WHERE EXISTS ( 
                SELECT 1 FROM filtered_decks fd 
                WHERE fd.id = ds.decklist_id 
            ) 
        ${includeSideDeck ? `
        UNION ALL 
        SELECT dss.decklist_id, dss.card_code 
        FROM decklist_side_slots dss 
        WHERE EXISTS ( 
            SELECT 1 FROM filtered_decks fd 
            WHERE fd.id = dss.decklist_id 
        )` : ''} 
    )
    SELECT t.card_code,
           $3 AS canonical_investigator_code,
           (SELECT COUNT(*) FROM filtered_decks) AS decks_analyzed,
           COUNT(DISTINCT d.id) AS decks_with_card
    FROM filtered_decks d 
    JOIN slots s ON d.id = s.decklist_id 
    JOIN ${cardsToRecommend} t ON s.card_code = t.card_code
    GROUP BY t.card_code
`;

    const params = [
        dateRange[0], dateRange[1], investigatorCode, requiredCards
    ];
    return await db.manyOrNone(query, params);
}

async function computeInclusionPercentagesForAllInvestigators(
    investigatorCode: string,
    dateRange: [Date, Date],
    db: ITask<{}>
): Promise<InclusionCount[]> {
    const query = `
    WITH decks_analyzed AS (
        SELECT canonical_investigator_code, 
               SUM(deck_count) AS decks_analyzed
        FROM investigator_deck_counts
        WHERE creation_month BETWEEN date_trunc('month', $2::DATE) AND date_trunc('month', $3::DATE)
        GROUP BY canonical_investigator_code
    ),
    counts AS (
        SELECT cs.card_code,
               dc.canonical_investigator_code,
               da.decks_analyzed,
               CASE 
                   WHEN cs.creation_month BETWEEN date_trunc('month', $2::DATE) AND date_trunc('month', $3::DATE) 
                   THEN cs.deck_count_with_card 
                   ELSE 0 
               END AS deck_count_with_card
        FROM investigator_deck_counts dc
        LEFT JOIN card_inclusion_counts cs ON dc.canonical_investigator_code = cs.canonical_investigator_code 
                                            AND dc.creation_month = cs.creation_month
        JOIN cards_to_recommend t ON cs.card_code = t.card_code
        JOIN decks_analyzed da ON dc.canonical_investigator_code = da.canonical_investigator_code
        WHERE dc.canonical_investigator_code != $1
    ),
    all_investigators AS (
        SELECT card_code,
               canonical_investigator_code,
               decks_analyzed AS decks_analyzed,
               SUM(COALESCE(cs.deck_count_with_card, 0)) AS decks_with_card
        FROM counts cs
        GROUP BY card_code, canonical_investigator_code, decks_analyzed
        UNION ALL
        SELECT * FROM percentages_for_investigator
    )
    SELECT * FROM all_investigators
    ORDER BY card_code, canonical_investigator_code
`;

    const params = [investigatorCode, dateRange[0], dateRange[1]];
    return await db.query(query, params);
}

export async function getInvestigatorName(investigatorCode: string, db: ITask<{}>): Promise<string|null> {
    const results = await db.query('SELECT investigator_name FROM decklists WHERE canonical_investigator_code = $1 LIMIT 1', [investigatorCode]);
    if (results.length === 0) {
        return null;
    }
    return results[0].investigator_name;
}

export function firstDayOfNextMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

export async function getRecommendations(
    request: RecommendationRequest,
    db: IDatabase<{}>,
    pgp: IMain,
) {
    const dateRange: [Date, Date] = [new Date(request.date_range[0]), firstDayOfNextMonth(new Date(request.date_range[1]))];
    const recommendations = await db.tx(async (t) => {
        // Create the temporary table
        await t.none(`
            CREATE TEMP TABLE cards_to_recommend (
                card_code VARCHAR(6) PRIMARY KEY
            ) ON COMMIT DROP;
        `);

        // Insert values into the temporary table
        const columns = new pgp.helpers.ColumnSet(['card_code'], { table: 'cards_to_recommend' });
        const cardData = request.cards_to_recommend.map((card_code) => ({ card_code }));
        const insertQuery = pgp.helpers.insert(cardData, columns);
        await t.none(insertQuery);

        const inclusionsForInvestigator = await computeInclusionPercentagesForInvestigator(
            request.canonical_investigator_code,
            request.analyze_side_decks,
            dateRange,
            request.required_cards,
            'cards_to_recommend',
            request.analysis_algorithm === "percentile rank",
            t
        );
        
        const investigatorName = await getInvestigatorName(request.canonical_investigator_code, t);
        if (investigatorName === null) {
            return {
                decks_analyzed: 0,
                recommendations: [],
            };
        }

        if (request.analysis_algorithm === "percentile rank") {
            const inclusions = await computeInclusionPercentagesForAllInvestigators(
                request.canonical_investigator_code,
                dateRange,
                t
            );

            let index = 0;
            const recommendations = [];
            while (index < inclusions.length) {
                const thisCardCode = inclusions[index].card_code;
                const inclusionsForCard = [];
                let thisInvestigatorInclusion = undefined;
                while (index < inclusions.length && inclusions[index].card_code === thisCardCode) {
                    inclusionsForCard.push(inclusions[index]);
                    if (inclusions[index].canonical_investigator_code === request.canonical_investigator_code) {
                        thisInvestigatorInclusion = inclusions[index];
                    }
                    index++;
                }

                // If no other investigators have access to this card, 
                // or we didn't find this investigator's inclusion, skip
                if (inclusionsForCard.length === 1 || thisInvestigatorInclusion === undefined) {
                    continue;
                }

                const thisPercentage = thisInvestigatorInclusion.decks_with_card / thisInvestigatorInclusion.decks_analyzed * 100;

                // Don't supply a recommendation if the inclusion percentage is too low
                // This filters out anomalies like cards that are barely ever used showing high in the percentile ranks
                if (thisPercentage < 5) {
                    continue;
                }

                const rank = percentileRank(
                    inclusionsForCard.map((inc) => (inc.decks_with_card / inc.decks_analyzed) * 100),
                    thisPercentage
                );
                recommendations.push({
                    card_code: thisCardCode,
                    recommendation: Math.floor(rank),
                    ordering: rank, // Put cards with a higher float rank first, even though we display the integer rank
                    explanation: `The percentile rank of ${investigatorName}'s use of this card compared to other investigators is ${Math.floor(rank)}`,
                });
            }
            const decksAnalyzed = await t.one(`
                SELECT SUM(deck_count) AS decks_analyzed
                FROM investigator_deck_counts
                WHERE creation_month BETWEEN date_trunc('month', $1::DATE) AND date_trunc('month', $2::DATE)
            `, dateRange);
            return {
                decks_analyzed: decksAnalyzed.decks_analyzed,
                recommendations: recommendations,
            };
        }
        else if (request.analysis_algorithm === "absolute percentage") {
            // Number of decks analysed will be the same for all cards
            const decksAnalyzed = inclusionsForInvestigator[0]?.decks_analyzed || 0;
            const recommendations = inclusionsForInvestigator.flatMap((inc) => {
                const inclusionPercentage = inc.decks_with_card / inc.decks_analyzed * 100;

                return [{
                    card_code: inc.card_code.toString().trim(),
                    recommendation: inclusionPercentage,
                    ordering: inclusionPercentage,
                    explanation: `${inclusionPercentage.toFixed(2)}% of ${investigatorName} decks (${inc.decks_with_card}/${inc.decks_analyzed}) use this card`,
                }];
            });
            return {
                decks_analyzed: decksAnalyzed,
                recommendations: recommendations,
            }
        }
        else {
            throw new Error(`Unknown analysis algorithm: ${request.analysis_algorithm}`);
        }
    });
    return recommendations;
}
