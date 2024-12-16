import { Deck, Id } from "./stolen.types";

export type Decklists = {
    [id: Id]: Deck;
}

// investigator_code -> month -> deck_id[]
export type DecksByInvestigator = Record<string, Record<string, Record<Id, 1>>>;

// card_code -> deck_id[]
export type CardInclusions = Record<string, Id[]>;

// investigator_code -> month -> card_code -> [mainDeckCount, mainDeckCount + sideDeckCount]
export type InvestigatorCounts = Record<string, Record<string, Record<string, [number, number]>>>;

export type InvestigatorNames = {
    [code: string]: string;
}