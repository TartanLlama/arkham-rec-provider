import { hasAccess } from "./access_checking";
import { CardInclusions, Decklists, DecksByInvestigator, InvestigatorCounts } from "./recommendations.types";
import { Id } from "./stolen.types";
import { Index, Recommendation, RecommendationAnalysisAlgorithm, RecommendationRequest } from "./index.types";

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

function findInclusionsOfCardForInvestigator(
    cardCode: string,
    deckInclusions: CardInclusions,
    sideDeckInclusions: CardInclusions,
    includeSideDeck: boolean,
    validDecks: Record<Id, 1>,
): number {
    let ret = new Set<Id>();
    const isValidDeck = (deckCode: Id) => validDecks[deckCode];
    if (deckInclusions[cardCode]) {
        ret = new Set(deckInclusions[cardCode].filter(isValidDeck));
    }
    if (includeSideDeck && sideDeckInclusions[cardCode]) {
        sideDeckInclusions[cardCode].filter(isValidDeck).forEach((deckCode) => ret.add(deckCode));
    }
    return ret.size;
}

function monthsInRange(dateRange: [Date, Date]): string[] {
    const start = dateRange[0];
    const end = dateRange[1];
    const months = [];
    for (let date = new Date(start); date < end; date.setMonth(date.getMonth() + 1)) {
        months.push(dateToMonth(date));
    }
    return months;
}

function decksForInvestigatorInDateRange(
    monthsFilter: string[],
    investigatorCode: string,
    decksByInvestigator: DecksByInvestigator
): number {
    return monthsFilter.reduce((acc, month) => {
        return decksByInvestigator[investigatorCode][month] ?
            acc + Object.keys(decksByInvestigator[investigatorCode][month]).length
            : acc;
    }, 0);
}

function inclusionPercentagesForOtherInvestigators(
    cardCode: string,
    investigatorCode: string,
    decksByInvestigator: DecksByInvestigator,
    countsByInvestigator: InvestigatorCounts,
    includeSideDeck: boolean,
    monthsFilter: string[],
) {
    const ret: Record<string, number> = {};
    for (const investigator of Object.keys(countsByInvestigator)) {
        if (investigator === investigatorCode || !hasAccess(investigator, cardCode)) {
            continue;
        }
        ret[investigator] = monthsFilter.reduce((acc, month) => {
            const counts = countsByInvestigator[investigator][month]?.[cardCode];
            acc += (includeSideDeck ? counts?.[1] : counts?.[0]) || 0;
            return acc;
        }, 0);
        const nDecks = decksForInvestigatorInDateRange(monthsFilter, investigator, decksByInvestigator);
        if (nDecks === 0) {
            ret[investigator] = 0;
        }
        else {
            ret[investigator] = (ret[investigator] / nDecks) * 100;
        }
    }
    return ret;
}

export function computeRecommendationForCard(
    cardCode: string,
    investigatorCode: string,
    index: Index,
    includeSideDeck: boolean,
    analysisAlgorithm: RecommendationAnalysisAlgorithm,
    dateRange: [Date, Date],
    validDecks: Record<Id, 1>,
): Recommendation | undefined {
    const {
        deckInclusions,
        sideDeckInclusions,
        decksByInvestigator,
        investigatorNames,
        deckInvestigatorCounts,
    } = index;

    const nInclusionsForInvestigator = findInclusionsOfCardForInvestigator(
        cardCode,
        deckInclusions,
        sideDeckInclusions,
        includeSideDeck,
        validDecks,
    );

    const inclusionPercentage = (nInclusionsForInvestigator / Object.keys(validDecks).length) * 100;

    // Don't supply a recommendation if the inclusion percentage is too low
    // This filters out anomalies like cards that are barely ever used showing high in the percentile ranks
    if (inclusionPercentage < 5) {
        return undefined;
    }
    const monthsFilter = monthsInRange(dateRange);

    if (analysisAlgorithm === "percentile rank") {
        const otherInclusions = inclusionPercentagesForOtherInvestigators(
            cardCode,
            investigatorCode,
            decksByInvestigator,
            deckInvestigatorCounts,
            includeSideDeck,
            monthsFilter
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
            explanation: `The percentile rank of ${investigatorNames[investigatorCode]}'s use of this card compared to other investigators is ${Math.floor(rank)}`,
        };
    }
    else if (analysisAlgorithm === "absolute percentage") {
        return {
            card_code: cardCode,
            recommendation: inclusionPercentage,
            ordering: inclusionPercentage,
            explanation: `${inclusionPercentage.toFixed(2)}% of ${investigatorNames[investigatorCode]} decks (${nInclusionsForInvestigator}/${Object.keys(validDecks).length}) use this card`,
        };
    }
}

export function firstDayOfNextMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function validDecksForInvestigator(
    investigatorCode: string,
    decklists: Decklists,
    decksByInvestigator: DecksByInvestigator,
    deckInclusions: CardInclusions,
    sideDeckInclusions: CardInclusions,
    includeSideDeck: boolean,
    dateRange: [Date, Date],
    requiredCards: string[],
    excludedCards: string[]
) {
    const validDecks: Record<Id, 1> = {};
    for (const month of Object.values(decksByInvestigator[investigatorCode])) {
        for (const deckCode of Object.keys(month)) {
            const publicationDate = new Date(decklists[deckCode].date_creation);
            const correctInvestigator = decklists[deckCode].investigator_code === investigatorCode;
            const inDateRange = publicationDate >= dateRange[0] && publicationDate < dateRange[1];
            const hasRequiredCards = requiredCards.every((requiredCard) =>
                decklists[deckCode].slots[requiredCard] ||
                (includeSideDeck && !Array.isArray(decklists[deckCode].sideSlots) && decklists[deckCode].sideSlots[requiredCard]));
            const doesNotHaveExcludedCards = !excludedCards.some((excludedCard) =>
                deckInclusions[excludedCard]?.includes(deckCode) ||
                (includeSideDeck && sideDeckInclusions[excludedCard]?.includes(deckCode)));
            const valid = correctInvestigator && inDateRange && hasRequiredCards && doesNotHaveExcludedCards;
            if (valid) {
                validDecks[deckCode] = 1;
            }
        }
    }
    return validDecks;
}

export function getRecommendations(
    request: RecommendationRequest,
    decklists: Decklists,
    index: Index
) {
    const dateRange: [Date, Date] = [new Date(request.date_range[0]), firstDayOfNextMonth(new Date(request.date_range[1]))];
    const validDecks = validDecksForInvestigator(
        request.investigator_code,
        decklists,
        index.decksByInvestigator,
        index.deckInclusions,
        index.sideDeckInclusions,
        request.analyze_side_decks,
        dateRange,
        request.required_cards,
        request.excluded_cards,
    );
    return request.cards_to_recommend.map((code) => {
        return computeRecommendationForCard(
            code,
            request.investigator_code,
            index,
            request.analyze_side_decks,
            request.analysis_algorithm,
            dateRange,
            validDecks,
        );
    }).filter((recommendation) => recommendation !== undefined);
}

