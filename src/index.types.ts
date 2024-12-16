import { CardInclusions, DecksByInvestigator, InvestigatorCounts, InvestigatorNames } from "./recommendations.types";

export type Recommendation = {
    card_code: string;
    recommendation: number;
    ordering: number;
    explanation: string;
};

export type Recommendations = {
    decks_analyzed: number;
    recommendations: Recommendation[];
};

export type RecommendationAnalysisAlgorithm = "absolute percentage" | "percentile rank";

export type RecommendationRequest = {
    investigator_code: string;
    analyze_side_decks: boolean;
    analysis_algorithm: RecommendationAnalysisAlgorithm;
    required_cards: string[];
    excluded_cards: string[];
    cards_to_recommend: string[];
    date_range: [string, string];
}

export type RecommendationApiResponse = {
    data: {
        recommendations: Recommendations;
    };
}

export type Index = {
    deckInclusions: CardInclusions;
    sideDeckInclusions: CardInclusions;
    deckInvestigatorCounts: InvestigatorCounts;
    decksByInvestigator: DecksByInvestigator;
    investigatorNames: InvestigatorNames;
};