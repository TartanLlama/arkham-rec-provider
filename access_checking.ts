// Lovingly stolen from arkham.build
import { Card, DeckOption, OptionSelect } from "./stolen.types";

type Mapping<V extends string | number> = Record<string, V>;

type LookupTable<
    T extends string | number,
    V extends string | number = 1,
> = Record<T, Mapping<V>>;

type LookupTables = {
    // TODO: add alternative_art investigators.
    relations: {
        // Base version for a parallel investigator.
        base: LookupTable<string, 1>;
        // `Hallowed Mirror` has bound `Soothing Melody`.
        bound: LookupTable<string, 1>;
        // `Soothing Melody` is bonded to `Hallowed Mirror`.
        bonded: LookupTable<string, 1>;
        // `Daisy's Tote Bag` is restrictory to `Daisy Walker`.
        restrictedTo: LookupTable<string, 1>;
        // `Daisy Walker`'s requires `Daisy's Tote Bag`.
        requiredCards: LookupTable<string, 1>;
        // Roland bannks has parallel card "Directive".
        parallelCards: LookupTable<string, 1>;
        // Parallel versions of an investigator.
        parallel: LookupTable<string, 1>;
        // Advanced requiredCards for an investigator.
        advanced: LookupTable<string, 1>;
        // Replacement requiredCards for an investigator.
        replacement: LookupTable<string, 1>;
        // Any card can have `n` different level version. (e.g. Ancient Stone)
        level: LookupTable<string, 1>;
        // Revised core "First Aid (3)"is a duplicate of Pallid Mask "First Aid (3)".
        duplicates: LookupTable<string, 1>;
    };
    traitsByCardTypeSelection: LookupTable<string, 1>;
    encounterCode: LookupTable<string>;
    typeCode: LookupTable<string>;
    subtypeCode: LookupTable<string>;
    actions: LookupTable<string>;
    factionCode: LookupTable<string>;
    properties: {
        fast: Mapping<1>;
        multislot: Mapping<1>;
        seal: Mapping<1>; // TODO: link the tokens?
        succeedBy: Mapping<1>;
    };
    skillBoosts: LookupTable<string>;
    traits: LookupTable<string>;
    uses: LookupTable<string>;
    level: LookupTable<number>;
};

function getInitialLookupTables(): LookupTables {
    return {
        relations: {
            base: {},
            bound: {},
            bonded: {},
            restrictedTo: {},
            requiredCards: {},
            parallel: {},
            parallelCards: {},
            advanced: {},
            replacement: {},
            level: {},
            duplicates: {},
        },
        actions: {},
        encounterCode: {},
        factionCode: {},
        subtypeCode: {},
        typeCode: {},
        properties: {
            fast: {},
            multislot: {},
            seal: {},
            succeedBy: {},
        },
        skillBoosts: {},
        traits: {},
        uses: {},
        level: {},
        traitsByCardTypeSelection: {},
    };
}

type GroupingType =
    | "cost"
    | "cycle"
    | "encounter_set"
    | "faction"
    | "base_upgrades"
    | "level"
    | "pack"
    | "slot"
    | "subtype"
    | "type";

type SortingType =
    | "position"
    | "name"
    | "level"
    | "cycle"
    | "faction"
    | "type"
    | "cost";

type ViewMode = "compact" | "card-text" | "full-cards" | "scans";

function time(a_: any) { }
function timeEnd(a_: any) { }
type ListConfig = {
    group: GroupingType[];
    sort: SortingType[];
    viewMode: ViewMode;
};
type SettingsState = {
    collection: Record<string, number>; // track as "quantity" owned to accomodate the core set.
    fontSize: number;
    hideWeaknessesByDefault: boolean;
    lists: {
        encounter: ListConfig;
        investigator: ListConfig;
        player: ListConfig;
        deck: ListConfig;
    };
    showPreviews: boolean;
    showAllCards: boolean;
    tabooSetId: number | undefined;
};


export const PLAYER_GROUPING_TYPES: GroupingType[] = [
    "base_upgrades",
    "cost",
    "cycle",
    "faction",
    "level",
    "pack",
    "slot",
    "subtype",
    "type",
];

export const ENCOUNTER_GROUPING_TYPES: GroupingType[] = [
    "cycle",
    "encounter_set",
    "pack",
    "subtype",
    "type",
];

export const PLAYER_DEFAULTS: ListConfig = {
    group: ["subtype", "type", "slot"],
    sort: ["name", "level"],
    viewMode: "compact",
};

export const ENCOUNTER_DEFAULTS: ListConfig = {
    group: ["pack", "encounter_set"],
    sort: ["position"],
    viewMode: "compact",
};

function getDefaultsForList(listKey: keyof SettingsState["lists"]) {
    if (listKey === "encounter") {
        return structuredClone(ENCOUNTER_DEFAULTS);
    }

    return structuredClone(PLAYER_DEFAULTS);
}

function getDefaultSettings(): SettingsState {
    return {
        collection: {},
        fontSize: 16,
        hideWeaknessesByDefault: false,
        lists: {
            encounter: getDefaultsForList("encounter"),
            investigator: getDefaultsForList("investigator"),
            player: getDefaultsForList("player"),
            deck: getDefaultsForList("deck"),
        },
        showPreviews: true,
        showAllCards: true,
        tabooSetId: 0,
    };
}

function applyTaboo(
    card: Card,
    metadata: Metadata,
    tabooSetId: number | null | undefined,
): Card {
    if (!tabooSetId) return card;

    const taboo = metadata.taboos[`${card.code}-${tabooSetId}`];
    return taboo
        ? // taboos duplicate the card structure, so a simple merge is safe to apply them.
        {
            ...card,
            ...taboo,
        }
        : card;
}

function createLookupTables(
    metadata: Metadata,
    settings: SettingsState,
) {
    time("refresh_lookup_tables");
    const lookupTables = getInitialLookupTables();

    const cards = Object.values(metadata.cards);

    for (const card of cards) {
        addCardToLookupTables(
            lookupTables,
            applyTaboo(card, metadata, settings.tabooSetId),
        );
    }

    createRelations(metadata, lookupTables);

    timeEnd("refresh_lookup_tables");
    return lookupTables;
}

function setInLookupTable<T extends string | number>(
    code: keyof LookupTable<T>[T] | string,
    index: LookupTable<T>,
    key: T,
) {
    if (index[key]) {
        index[key][code] = 1;
    } else {
        index[key] = { [code]: 1 as const };
    }
}

function addCardToLookupTables(tables: LookupTables, card: Card) {
    indexByCodes(tables, card);
    indexByTraits(tables, card);
    indexByActions(tables, card);
    indexByFast(tables, card);

    // handle additional index based on whether we are dealing with a player card or not.
    if (card.faction_code !== "mythos") {
        indexByLevel(tables, card);

        indexByMulticlass(tables, card);

        indexBySeal(tables, card);

        indexBySucceedsBy(tables, card);

        if (card.type_code === "asset") {
            indexBySkillBoosts(tables, card);
            indexByUses(tables, card);
        }
    } else {
        // TODO: add enemy filters.
    }
}

function indexByCodes(tables: LookupTables, card: Card) {
    setInLookupTable(card.code, tables.factionCode, card.faction_code);
    setInLookupTable(card.code, tables.typeCode, card.type_code);

    if (card.subtype_code) {
        setInLookupTable(card.code, tables.subtypeCode, card.subtype_code);
    }

    if (card.encounter_code) {
        setInLookupTable(card.code, tables.encounterCode, card.encounter_code);
    }
}

function indexByTraits(tables: LookupTables, card: Card) {
    for (const trait of splitMultiValue(card.real_traits)) {
        setInLookupTable(card.code, tables.traits, trait);

        if (card.encounter_code || card.faction_code === "mythos") {
            setInLookupTable(trait, tables.traitsByCardTypeSelection, "encounter");
        } else {
            setInLookupTable(trait, tables.traitsByCardTypeSelection, "player");
        }
    }
}
const ACTION_TEXT: { [key: string]: string } = {
    fight: "Fight.",
    engage: "Engage.",
    investigate: "Investigate.",
    draw: "Draw.",
    move: "Move.",
    evade: "Evade.",
    parley: "Parley.",
} as const;

const ACTION_TEXT_ENTRIES = Object.entries(ACTION_TEXT);
function indexByActions(tables: LookupTables, card: Card) {
    // add card to action tables.
    for (const [key, value] of ACTION_TEXT_ENTRIES) {
        if (card.real_text?.includes(value)) {
            setInLookupTable(card.code, tables.actions, key);
        }
    }
}

// TODO: use a regex.
function indexByFast(tables: LookupTables, card: Card) {
    if (
        card?.real_text?.includes("Fast.") ||
        card.real_text?.includes("gains fast.")
    ) {
        setInLookupTable(card.code, tables.properties, "fast");
    }
}

function indexByLevel(tables: LookupTables, card: Card) {
    if (card.xp) setInLookupTable(card.code, tables.level, card.xp);
}

function indexByMulticlass(tables: LookupTables, card: Card) {
    if (card.faction2_code) {
        setInLookupTable(card.code, tables.factionCode, card.faction2_code);
    }

    if (card.faction3_code) {
        setInLookupTable(card.code, tables.factionCode, card.faction3_code);
    }
}

// TODO: use a regex.
function indexBySeal(tables: LookupTables, card: Card) {
    if (
        card?.real_text?.includes(" seal ") ||
        card.real_text?.includes("Seal (")
    ) {
        setInLookupTable(card.code, tables.properties, "seal");
    }
}

const REGEX_SKILL_BOOST = /\+\d+?\s\[(.+?)\]/g;

const REGEX_USES = /Uses\s\(\d+?\s(\w+?)\)/;

const REGEX_BONDED = /^Bonded\s\((.*?)\)(\.|\s)/;

const REGEX_SUCCEED_BY =
    /succe(ssful|ed(?:s?|ed?))(:? at a skill test)? by(?! 0)/;

// TODO: handle "+X skill value".
function indexBySkillBoosts(tables: LookupTables, card: Card) {
    if (card.customization_options?.find((o) => o.choice === "choose_skill")) {
        setInLookupTable(card.code, tables.skillBoosts, "willpower");
        setInLookupTable(card.code, tables.skillBoosts, "intellect");
        setInLookupTable(card.code, tables.skillBoosts, "combat");
        setInLookupTable(card.code, tables.skillBoosts, "agility");
    }

    const matches = card.real_text?.matchAll(REGEX_SKILL_BOOST);
    if (!matches) return;

    for (const match of matches) {
        if (match.length > 0) {
            setInLookupTable(card.code, tables.skillBoosts, match[1]);
        }
    }
}

function indexByUses(tables: LookupTables, card: Card) {
    const match = card.real_text?.match(REGEX_USES);

    if (match && match.length > 0) {
        setInLookupTable(
            card.code,
            tables.uses,
            match[1] === "charge" ? "charges" : match[1],
        );
    }
}
type QueryEncounterSet = {
    code: string;
    name: string;
};
type DataVersion = {
    card_count: number;
    cards_updated_at: string;
    locale: string;
    translation_updated_at: string;
};

type EncounterSet = QueryEncounterSet & {
    pack_code: string;
};

type Cycle = {
    code: string;
    real_name: string;
    position: number;
};

type Faction = {
    code: string;
    name: string;
    is_primary: boolean;
};

type SubType = {
    code: string;
    name: string;
};

type Type = {
    code: string;
    name: string;
};


type Taboo = {
    code: string;
    real_text?: string;
    real_back_text?: string;
    real_taboo_text_change?: string;
    taboo_xp?: number;
    taboo_set_id: number;
    exceptional?: boolean; // key of ys.
    real_customization_text?: string;
    real_customization_change?: Card["real_customization_change"];
    customization_options?: Card["customization_options"];
    deck_requirements?: Card["deck_requirements"];
    deck_options?: Card["deck_options"];
};

type TabooSet = {
    id: number;
    name: string;
    card_count: number;
    date: string;
};


type Metadata = {
    cards: Record<string, Card>;
    dataVersion?: DataVersion;
    encounterSets: Record<string, EncounterSet>;
    cycles: Record<string, Cycle>;
    factions: Record<string, Faction>;
    subtypes: Record<string, SubType>;
    types: Record<string, Type>;
    tabooSets: Record<string, TabooSet>;
    taboos: Record<string, Taboo>;
};

function indexBySucceedsBy(tables: LookupTables, card: Card) {
    if (card.real_text?.match(REGEX_SUCCEED_BY)) {
        setInLookupTable(card.code, tables.properties, "succeedBy");
    }
}

function createRelations(metadata: Metadata, tables: LookupTables) {
    time("create_relations");
    const cards = Object.values(metadata.cards);

    const bonded: Record<string, string[]> = {};
    const upgrades: Record<
        string,
        { code: string; subname?: string; xp: number }[]
    > = {};

    const backs: Record<string, string> = {};

    // first pass: identify target cards.
    for (const card of cards) {
        if (card.xp && card.xp >= 0) {
            const upgrade = {
                code: card.code,
                subname: card.real_subname,
                xp: card.xp,
            };

            if (!upgrades[card.real_name]) {
                upgrades[card.real_name] = [upgrade];
            } else {
                upgrades[card.real_name].push(upgrade);
            }
        }

        const match = card.real_text?.match(REGEX_BONDED);

        if (match && match.length > 0) {
            if (!bonded[match[1]]) {
                bonded[match[1]] = [card.code];
            } else {
                bonded[match[1]].push(card.code);
            }
        }

        if (card.back_link_id) {
            backs[card.back_link_id] = card.code;
        }
    }

    // second pass: construct lookup tables.
    for (const card of cards) {
        if (card.deck_requirements?.card) {
            for (const code of Object.keys(card.deck_requirements.card)) {
                setInLookupTable(code, tables.relations.requiredCards, card.code);
            }
        }

        if (card.restrictions?.investigator && !card.hidden) {
            // Can have multiple entries (alternate arts).
            for (const key of Object.keys(card.restrictions.investigator)) {
                const investigator = metadata.cards[key];

                if (investigator.duplicate_of_code) {
                    setInLookupTable(
                        investigator.duplicate_of_code,
                        tables.relations.restrictedTo,
                        card.code,
                    );
                    continue;
                }

                setInLookupTable(key, tables.relations.restrictedTo, card.code);

                if (card.real_text?.includes("Advanced.")) {
                    setInLookupTable(card.code, tables.relations.advanced, key);
                } else if (
                    // special case: gloria currently only has replacement cards, prefer them as required.
                    card.real_text?.includes("Replacement.") &&
                    card.code !== "98020" &&
                    card.code !== "98021"
                ) {
                    setInLookupTable(card.code, tables.relations.replacement, key);
                } else {
                    if (card.parallel) {
                        setInLookupTable(card.code, tables.relations.parallelCards, key);
                    } else {
                        setInLookupTable(card.code, tables.relations.requiredCards, key);
                    }
                }
            }
        }

        if (
            card.type_code === "investigator" &&
            card.parallel &&
            card.alt_art_investigator &&
            card.alternate_of_code
        ) {
            setInLookupTable(
                card.code,
                tables.relations.parallel,
                card.alternate_of_code,
            );

            setInLookupTable(
                card.alternate_of_code,
                tables.relations.base,
                card.code,
            );
        }

        if (card.duplicate_of_code) {
            setInLookupTable(
                card.code,
                tables.relations.duplicates,
                card.duplicate_of_code,
            );
        }

        if (upgrades[card.real_name] && card.xp != null) {
            for (const upgrade of upgrades[card.real_name]) {
                if (
                    card.code !== upgrade.code &&
                    (!card.real_subname ||
                        card.xp !== upgrade.xp ||
                        upgrade.subname !== card.real_subname)
                ) {
                    setInLookupTable(upgrade.code, tables.relations.level, card.code);
                    setInLookupTable(card.code, tables.relations.level, upgrade.code);
                }
            }
        }

        // Index cards by back traits.

        if (card.real_back_traits) {
            for (const trait of splitMultiValue(card.real_back_traits)) {
                setInLookupTable(card.code, tables.traits, trait);
            }
        }

        if (backs[card.code] && card.real_traits) {
            for (const trait of splitMultiValue(card.real_traits)) {
                setInLookupTable(backs[card.code], tables.traits, trait);
            }
        }

        // TODO: there is an edge case with Dream-Gate where the front should show when accessing `06015b` via
        // a bond, but currently does not.
        if (!card.linked && bonded[card.real_name]) {
            for (const bondedCode of bonded[card.real_name]) {
                // beware the great hank samson.
                if (bondedCode !== card.code && !card.real_text?.startsWith("Bonded")) {
                    setInLookupTable(bondedCode, tables.relations.bound, card.code);
                    setInLookupTable(card.code, tables.relations.bonded, bondedCode);
                }
            }
        }
    }

    for (const [investigator, entry] of Object.entries(
        tables.relations.parallel,
    )) {
        const parallel = Object.keys(entry)[0];

        tables.relations.advanced[parallel] =
            tables.relations.advanced[investigator];
        tables.relations.replacement[parallel] =
            tables.relations.replacement[investigator];
        tables.relations.bonded[parallel] = tables.relations.bonded[investigator];
        tables.relations.parallelCards[parallel] =
            tables.relations.parallelCards[investigator];

        for (const [key, value] of Object.entries(tables.relations.restrictedTo)) {
            if (value[investigator]) {
                setInLookupTable(parallel, tables.relations.restrictedTo, key);
            }
        }
    }

    timeEnd("create_relations");
}

type Filter = (x: any) => boolean;

const SPECIAL_CARD_CODES = {
    /** Can be in ignore deck limit slots for TCU. */
    ACE_OF_RODS: "05040",
    /** Changes XP calculation for upgrades. */
    ADAPTABLE: "02110",
    /** Adjusts deck size, has separate deck. */
    ANCESTRAL_KNOWLEDGE: "07303",
    /** Changes XP calculation for upgrades. */
    ARCANE_RESEARCH: "04109",
    /** Has separate deck. */
    BEWITCHING: "10079",
    /** Quantity scales with signature count. */
    BURDEN_OF_DESTINY: "08015",
    /** Allows to exile arbitrary cards. */
    BURN_AFTER_READING: "08076",
    /** Changes XP calculation for upgrades. */
    DEJA_VU: "60531",
    /** Connected to parallel roland's front. */
    DIRECTIVE: "90025",
    /** Changes XP calculation for upgrades. */
    DOWN_THE_RABBIT_HOLE: "08059",
    /** Adjusts deck size. */
    FORCED_LEARNING: "08031",
    /** Has separate deck. */
    JOE_DIAMOND: "05002",
    /** Has deck size selection (and accompanying taboo). */
    MANDY: "06002",
    /** Scales with investigator deck size selection. */
    OCCULT_EVIDENCE: "06008",
    /** Adds deckbuilding restriction. */
    ON_YOUR_OWN: "53010",
    /** Has option to add cards to ignore deck limit slots. */
    PARALLEL_AGNES: "90017",
    /** Has spirit deck. */
    PARALLEL_JIM: "90049",
    /** Has option to add cards to ignore deck limit slots. */
    PARALLEL_SKIDS: "90008",
    /** Parallel front has deckbuilding impact. */
    PARALLEL_ROLAND: "90024",
    /** Parallel front has deckbuilding impact. */
    PARALLEL_WENDY: "90037",
    /** Random basic weakness placeholder. */
    RANDOM_BASIC_WEAKNESS: "01000",
    /** Separate deck. */
    STICK_TO_THE_PLAN: "03264",
    /** Additional XP gain, switches deck investigator with a static investigator on defeat. */
    THE_GREAT_WORK: "11068a",
    /** Investigator can be transformed into this. */
    LOST_HOMUNCULUS: "11068b",
    /** Additional deck building not reflected in deck options. */
    SUZI: "89001",
    /** Connected to parallel wendy's front. */
    TIDAL_MEMENTO: "90038",
    /** Adjusts deck size, has separate deck. */
    UNDERWORLD_MARKET: "09077",
    /** adds deckbuilding requirements. */
    UNDERWORLD_SUPPORT: "08046",
    /** Weakness starts in hunch deck. */
    UNSOLVED_CASE: "05010",
    /** Weakness starts in spirit deck. */
    VENGEFUL_SHADE: "90053",
    /** Adds deckbuilding restriction, adjusts deck size. */
    VERSATILE: "06167",
};

function and(fns: Filter[]) {
    return (element: any) => !fns.length || fns.every((f) => f(element));
}

function or(fns: Filter[]) {
    return (element: any) => !fns.length || fns.some((f) => f(element));
}


function not(fn: Filter): Filter {
    return (element: any) => !fn(element);
}

function notUnless(
    notFilter: Filter,
    unlessFilters: Filter[],
) {
    return (element: any) => {
        const unless = !!unlessFilters.length && or(unlessFilters)(element);
        return unless || not(notFilter)(element);
    };
}

function filterInvestigatorAccess(
    investigator: Card,
    lookupTables: LookupTables,
    config?: any,
): Filter | undefined {
    const mode = config?.targetDeck ?? "slots";

    const deckFilter =
        mode !== "extraSlots"
            ? makePlayerCardsFilter(
                investigator,
                lookupTables,
                "deck_options",
                "deck_requirements",
                config,
            )
            : undefined;

    const extraDeckFilter =
        mode !== "slots"
            ? makePlayerCardsFilter(
                investigator,
                lookupTables,
                "side_deck_options",
                "side_deck_requirements",
                config,
            )
            : undefined;

    if (mode !== "extraSlots" && !deckFilter) {
        console.warn(
            `filter is a noop: ${investigator.code} is not an investigator.`,
        );
    }

    if (mode === "slots") return deckFilter;
    if (mode === "extraSlots") return extraDeckFilter;

    const filters = [];

    if (deckFilter) filters.push(deckFilter);
    if (extraDeckFilter) filters.push(extraDeckFilter);
    return or(filters);
}

function splitMultiValue(s?: string) {
    if (!s) return [];
    return s.split(".").reduce<string[]>((acc, curr) => {
        const s = curr.trim();
        if (s) acc.push(s);
        return acc;
    }, []);
}

function filterRestrictions(card: Card, investigator: Card) {
    if (Array.isArray(card.restrictions?.trait)) {
        const targetTraits = card.restrictions.trait;
        return splitMultiValue(investigator.real_traits).some((t) =>
            targetTraits.includes(t.toLowerCase()),
        );
    }

    return true;
}

type MultiselectFilter = string[];
function filterType(enabledTypeCodes: MultiselectFilter) {
    return (card: Card) => enabledTypeCodes.includes(card.type_code);
}

function filterMulticlass(card: Card) {
    return !!card.faction2_code;
}

function filterFaction(faction: string) {
    return (card: Card) =>
        card.faction_code === faction ||
        (!!card.faction2_code && card.faction2_code === faction) ||
        (!!card.faction3_code && card.faction3_code === faction);
}

function filterRequired(
    code: string,
    relationsTable: LookupTables["relations"],
) {
    return (card: Card) =>
        !!relationsTable.advanced[code]?.[card.code] ||
        !!relationsTable.requiredCards[code]?.[card.code] ||
        !!relationsTable.parallelCards[code]?.[card.code] ||
        !!relationsTable.replacement[code]?.[card.code];
}

function filterFactions(factions: string[]) {
    const ands: Filter[] = [];
    const ors: Filter[] = [];

    for (const faction of factions) {
        if (faction === "multiclass") {
            ands.push(filterMulticlass);
        } else {
            ors.push(filterFaction(faction));
        }
    }

    const filter = and([or(ors), ...ands]);
    return (card: Card) => filter(card);
}

function cardLevel(card: Card) {
    return card.customization_xp
        ? Math.round(card.customization_xp / 2)
        : card.xp;
}
function filterTag(tag: string, checkCustomizableOptions: boolean) {
    return (card: Card) => {
        const hasTag = !!card.tags?.includes(tag);

        if (hasTag || !checkCustomizableOptions || !card.customization_options)
            return hasTag;

        return !!card.customization_options?.some((o) => o.tags?.includes(tag));
    };
}

function filterCardLevel(value: [number, number], checkCustomizable = false) {
    return (card: Card) => {
        const level = cardLevel(card);

        // customizable cards can have any level, always show them when flag set.
        if (!checkCustomizable && card.customization_options) return true;

        return level != null && level >= value[0] && level <= value[1];
    };
}

function filterTraits(
    filterState: MultiselectFilter,
    traitTable: LookupTables["traits"],
    checkCustomizableOptions?: boolean,
) {
    const filters: Filter[] = [];

    for (const key of filterState) {
        filters.push((card: Card) => {
            const hasTrait = !!traitTable[key][card.code];

            if (
                hasTrait ||
                !card.customization_options ||
                !checkCustomizableOptions
            ) {
                return hasTrait;
            }

            return !!card.customization_options?.some((o) =>
                o.real_traits?.includes(key),
            );
        });
    }

    const filter = or(filters);
    return (card: Card) => filter(card);
}

function filterUses(uses: string, usesTable: LookupTables["uses"]) {
    return (card: Card) => !!usesTable[uses]?.[card.code];
}

function filterSeal(sealTable: LookupTables["properties"]["seal"]) {
    return (card: Card) => !!sealTable[card.code];
}

function filterPermanent(card: Card) {
    return !!card.permanent;
}

function isOptionSelect(x: unknown): x is OptionSelect {
    return typeof x === "object" && x != null && "id" in x;
}

function filterHealsHorror(checkCustomizableOptions: boolean) {
    return filterTag("hh", checkCustomizableOptions);
}
function capitalize(s: string | number) {
    const str = s.toString();
    if (!str.length) return str;

    return `${str[0].toUpperCase()}${str.slice(1)}`;
}

function filterHealsDamage(checkCustomizableOptions: boolean) {
    return filterTag("hd", checkCustomizableOptions);
}
function filterSlots(slot: string) {
    return (card: Card) => !!card.real_slot?.includes(slot);
}

function makeOptionFilter(
    option: DeckOption,
    lookupTables: LookupTables,
    config?: any,
) {
    // unknown rules or duplicate rules.
    if (
        option.deck_size_select ||
        option.tag?.includes("st") ||
        option.tag?.includes("uc")
    ) {
        return undefined;
    }

    const optionFilter = [];

    let filterCount = 0;

    if (option.not) {
        filterCount += 1;
    }

    if (option.limit) {
        filterCount += 1;
    }

    if (option.faction) {
        filterCount += 1;
        optionFilter.push(filterFactions(option.faction));
    }

    if (option.faction_select) {
        filterCount += 1;

        const targetKey = option.id ?? "faction_selected";

        const selection = config?.selections?.[targetKey]?.value;

        optionFilter.push(
            typeof selection === "string"
                ? filterFactions([selection])
                : filterFactions(option.faction_select),
        );
    }

    if (option.base_level || option.level) {
        const level = option.base_level ?? option.level;
        if (level) {
            filterCount += 1;
            optionFilter.push(filterCardLevel([level.min, level.max], true));
        }
    }

    if (option.permanent) {
        optionFilter.push(filterPermanent);
        // explicit `false` means "forbidden", absence of `permanent` means "either allowed".
    } else if (option.permanent === false) {
        optionFilter.push(not(filterPermanent));
    }

    if (option.trait) {
        filterCount += 1;

        optionFilter.push(
            filterTraits(
                // traits are stored lowercased for whatever reason.
                option.trait.map(capitalize),
                lookupTables.traits,
                !config?.ignoreUnselectedCustomizableOptions,
            ),
        );
    }

    if (option.uses) {
        filterCount += 1;

        const usesFilters: Filter[] = [];

        for (const uses of option.uses) {
            usesFilters.push(filterUses(uses, lookupTables.uses));
        }

        optionFilter.push(or(usesFilters));
    }

    if (option.type) {
        filterCount += 1;
        optionFilter.push(filterType(option.type));
    }

    // parallel wendy
    if (option.option_select) {
        const selectFilters: Filter[] = [];

        let selection = config?.selections?.["option_selected"]?.value;
        selection = isOptionSelect(selection) ? selection.id : undefined;

        for (const select of option.option_select) {
            if (selection && select.id !== selection) {
                continue;
            }

            const optionSelectFilters: Filter[] = [];

            if (select.level) {
                optionSelectFilters.push(
                    filterCardLevel([select.level.min, select.level.max], true),
                );
            }

            if (select.trait) {
                optionSelectFilters.push(
                    filterTraits(select.trait.map(capitalize), lookupTables.traits),
                );
            }

            selectFilters.push(and(optionSelectFilters));
        }

        filterCount += selectFilters.length + 1;
        optionFilter.push(or(selectFilters));
    }

    // TODO: generalize tag based access.

    // special case: allessandra
    if (option.text?.some((s) => s.includes("Parley"))) {
        filterCount += 1;
        optionFilter.push(filterTag("pa", true));
    }

    // carolyn fern
    if (option.tag?.includes("hh")) {
        filterCount += 1;
        optionFilter.push(
            filterHealsHorror(!config?.ignoreUnselectedCustomizableOptions),
        );
    }

    // vincent
    if (option.tag?.includes("hd")) {
        filterCount += 1;
        optionFilter.push(
            filterHealsDamage(!config?.ignoreUnselectedCustomizableOptions),
        );
    }

    // parallel mateo
    if (option.tag?.includes("se")) {
        filterCount += 1;
        optionFilter.push(filterSeal(lookupTables.properties.seal));
    }

    // on your own
    if (option.slot) {
        filterCount += 1;
        for (const slot of option.slot) {
            optionFilter.push(filterSlots(slot));
        }
    }

    if (filterCount <= 1) {
        console.debug("unknown deck requirement", option);
    }

    return filterCount > 1 ? and(optionFilter) : undefined;
}

function makePlayerCardsFilter(
    investigator: Card,
    lookupTables: LookupTables,
    optionsAccessor: "deck_options" | "side_deck_options",
    requiredAccessor: "deck_requirements" | "side_deck_requirements",
    config?: any,
) {
    let options = investigator[optionsAccessor];
    const requirements = investigator[requiredAccessor]?.card;

    if (!requirements || !options) {
        return undefined;
    }

    // normalize parallel investigators to root for lookups.
    const code = investigator.alternate_of_code ?? investigator.code;

    // special case: suzi's additional deck options allow any xp card.
    if (code === SPECIAL_CARD_CODES.SUZI) {
        options = [...options];
        options.splice(1, 0, {
            level: { max: 5, min: 0 },
            faction: ["neutral", "guardian", "mystic", "rogue", "seeker", "survivor"],
        });
    }

    const ands: Filter[] = [
        (card: Card) => filterRestrictions(card, investigator),
        not(filterType(["investigator", "location", "story"])),
    ];

    const ors: Filter[] = [];

    if (config?.targetDeck === "extraSlots") {
        ors.push((card: Card) => card.code in requirements);
    } else {
        ors.push(
            filterRequired(code, lookupTables.relations),
            (card: Card) => card.subtype_code === "basicweakness",
            (card: Card) =>
                !!card.encounter_code &&
                !!card.deck_limit &&
                !card.back_link_id &&
                !card.double_sided &&
                card.faction_code !== "mythos",
        );
    }

    const filters: Filter[] = [];

    for (const option of options) {
        const filter = makeOptionFilter(option, lookupTables, config);

        if (!filter) continue;

        if (option.not) {
            // When encountering a NOT, every filter that comes before can be considered an "unless".
            ands.push(filters.length ? notUnless(filter, [...filters]) : not(filter));
        } else {
            filters.push(filter);
        }
    }

    ors.push(...filters);

    if (config?.targetDeck !== "extraSlots" && config?.additionalDeckOptions) {
        for (const option of config.additionalDeckOptions) {
            const filter = makeOptionFilter(option, lookupTables, config);
            if (!filter) continue;

            if (option.not) {
                ands.push(not(filter));
            } else {
                ors.push(filter);
            }
        }
    }

    return and([or(ors), ...ands]);
}

const metadata: Metadata = {
    cards: {},
    encounterSets: {},
    cycles: {},
    factions: {},
    subtypes: {},
    types: {},
    tabooSets: {},
    taboos: {},
};

let lookupTables: LookupTables = getInitialLookupTables();

export function initAccessChecking(cards: Card[]) {
    metadata.cards = cards.reduce<Record<string, Card>>((acc, card) => {
        acc[card.code] = card;
        return acc;
    }, {});
    for (const c of cards) {
        if (c.taboo_set_id) {
            metadata.taboos[`${c.code}-${c.taboo_set_id}`] = {
                code: c.code,
                real_text: c.real_text,
                real_back_text: c.real_back_text,
                real_taboo_text_change: c.real_taboo_text_change,
                taboo_set_id: c.taboo_set_id,
                taboo_xp: c.taboo_xp,
                exceptional: c.exceptional,
                deck_requirements: c.deck_requirements,
                deck_options: c.deck_options,
                customization_options: c.customization_options,
                real_customization_text: c.real_customization_text,
                real_customization_change: c.real_customization_change,
            };
        }
    }
    lookupTables = createLookupTables(metadata, getDefaultSettings());
}

export function hasAccess(
    investigatorCode: string,
    cardCode: string,
) {
    const filter = filterInvestigatorAccess(
        metadata.cards[investigatorCode],
        lookupTables,
        {
            additionalDeckOptions: undefined,
            ignoreUnselectedCustomizableOptions: false,
            selections: undefined,
            targetDeck: "slots"
        }
    );
    return filter && filter(metadata.cards[cardCode]);
}