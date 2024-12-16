# Arkham Horror LCG Recommendation Provider

# Running

```shell
$ npm install
$ npm start
Server running at http://localhost:9191/
```

# Request Format

```ts
type RecommendationAnalysisAlgorithm = "absolute percentage" | "percentile rank";

type RecommendationRequest = {
    investigator_code: string;
    analyze_side_decks: boolean;
    analysis_algorithm: RecommendationAnalysisAlgorithm;
    required_cards: string[];
    excluded_cards: string[];
    cards_to_recommend: string[];
    date_range: [string, string];
}
```

For example:

```json
{
    "investigator_code": "05001",
    "analyze_side_decks": true,
    "analysis_algorithm": "percentile rank",
    "required_cards": [
        "08044"
    ],
    "excluded_cards": [],
    "cards_to_recommend": [
        "09040",
        "09058",
        "08044",
        "10061",
        "09056"
    ],
    "date_range": [
        "2024-03",
        "2024-12"
    ]
}
```

# Response

```ts
type Recommendation = {
    card_code: string;
    recommendation: number;
    ordering: number;
    explanation: string;
};

type Recommendations = {
    decks_analyzed: number;
    recommendations: Recommendation[];
};

type RecommendationApiResponse = {
    data: {
        recommendations: Recommendations;
    };
}
```

For example:

```json
{
    "data": {
        "recommendations": {
            "decks_analyzed": 13847,
            "recommendations": [
                {
                    "card_code": "09040",
                    "recommendation": 96,
                    "ordering": 96.55172413793103,
                    "explanation": "The percentile rank of Carolyn Fern's use of this card compared to other investigators is 96"
                },
                {
                    "card_code": "09058",
                    "recommendation": 92,
                    "ordering": 92.85714285714286,
                    "explanation": "The percentile rank of Carolyn Fern's use of this card compared to other investigators is 92"
                },
                {
                    "card_code": "08044",
                    "recommendation": 100,
                    "ordering": 100,
                    "explanation": "The percentile rank of Carolyn Fern's use of this card compared to other investigators is 100"
                }
            ]
        }
    }
}
```