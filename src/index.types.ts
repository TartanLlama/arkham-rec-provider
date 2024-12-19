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
    canonical_investigator_code: string;
    analyze_side_decks: boolean;
    analysis_algorithm: RecommendationAnalysisAlgorithm;
    required_cards: string[];
    cards_to_recommend: string[];
    date_range: [string, string];
}

export type RecommendationApiResponse = {
    data: {
        recommendations: Recommendations;
    };
}
