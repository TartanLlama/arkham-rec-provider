// Lovingly stolen from arkham.build
import { Card, DeckOption, OptionSelect } from "./stolen.types";

type Filterable = Card;
export type Filter<T extends Filterable = Card> = (x: T) => boolean;

export function and<T extends Filterable = Card>(fns: Filter<T>[]) {
    return (element: T) => !fns.length || fns.every((f) => f(element));
}

export function or<T extends Filterable = Card>(fns: Filter<T>[]) {
    return (element: T) => !fns.length || fns.some((f) => f(element));
}

export function not<T extends Filterable = Card>(fn: Filter<T>): Filter<T> {
    return (element: T) => !fn(element);
}

export function notUnless<T extends Filterable = Card>(
    notFilter: Filter<T>,
    unlessFilters: Filter<T>[],
) {
    return (element: T) => {
        const unless = !!unlessFilters.length && or(unlessFilters)(element);
        return unless || not(notFilter)(element);
    };
}


type DeckSizeSelection = {
    type: "deckSize";
    value: number;
    options: number[];
    name: string;
    accessor: string;
};

type FactionSelection = {
    type: "faction";
    value?: string;
    options: string[];
    name: string;
    accessor: string;
};

type OptionSelection = {
    type: "option";
    value?: OptionSelect;
    options: OptionSelect[];
    name: string;
    accessor: string;
};

export function isOptionSelect(x: unknown): x is OptionSelect {
    return typeof x === "object" && x != null && "id" in x;
}

export type Selection = OptionSelection | FactionSelection | DeckSizeSelection;
export type Selections = Record<string, Selection>;


/**
 * Investigator access
 */

export function filterRequired(investigator: Card) {
    return (card: Card) => {
        if (!card.restrictions?.investigator) return false;

        return (
            !!card.restrictions.investigator[investigator.code] ||
            (!!investigator.duplicate_of_code &&
                !!card.restrictions.investigator[investigator.duplicate_of_code]) ||
            (!!investigator.alternate_of_code &&
                !!card.restrictions.investigator[investigator.alternate_of_code])
        );
    };
}

export type InvestigatorAccessConfig = {
    additionalDeckOptions?: DeckOption[];
    // Customizable options can alter whether an investigator has access to a card.
    // Example: a card gains a trait, or the option to heal horror.
    //  -> when showing options, we want to show these cards.
    //  -> when validating decks, we only want to consider actually applied options.
    // This works because we apply the current card changes before we pass cards to the filter.
    // NOTE: this currently does not consider the "level" of the customizable option for access
    // because all current cases work. This assumption might break in the future.
    ignoreUnselectedCustomizableOptions?: boolean;
    selections?: Selections;
    targetDeck?: "slots" | "extraSlots" | "both";
};
function filterMulticlass(card: Card) {
    return !!card.faction2_code;
}

function filterFaction(faction: string) {
    return (card: Card) =>
        card.faction_code === faction ||
        (!!card.faction2_code && card.faction2_code === faction) ||
        (!!card.faction3_code && card.faction3_code === faction);
}

export function filterFactions(factions: string[]) {
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


export function cardLevel(card: Card) {
    return card.customization_xp
        ? Math.round(card.customization_xp / 2)
        : card.xp;
}

function filterCardLevel(value: [number, number], checkCustomizable = false) {
    return (card: Card) => {
        const level = cardLevel(card);

        // customizable cards can have any level, always show them when flag set.
        if (!checkCustomizable && card.customization_options) return true;

        return level != null && level >= value[0] && level <= value[1];
    };
}


function filterPermanent(card: Card) {
    return !!card.permanent;
}


function filterSlots(slot: string) {
    return (card: Card) => !!card.real_slot?.includes(slot);
}

export function capitalize(s: string | number) {
    const str = s.toString();
    if (!str.length) return str;

    return `${str[0].toUpperCase()}${str.slice(1)}`;
}

function filterTag(tag: string, checkCustomizableOptions: boolean) {
    return (card: Card) => {
        const hasTag = !!card.tags?.includes(tag);

        if (hasTag || !checkCustomizableOptions || !card.customization_options)
            return hasTag;

        return !!card.customization_options?.some((o) => o.tags?.includes(tag));
    };
}

function filterHealsDamage(checkCustomizableOptions: boolean) {
    return filterTag("hd", checkCustomizableOptions);
}

function filterHealsHorror(checkCustomizableOptions: boolean) {
    return filterTag("hh", checkCustomizableOptions);
}

export const REGEX_USES = /Uses\s\(\d+?\s(\w+?)\)/;
export function cardUses(card: Card) {
    const firstLine = card.real_text?.split("\n").at(0);
    const match = firstLine?.match(REGEX_USES);

    if (match?.length) {
        return match[1] === "charge" ? "charges" : match[1];
    }

    return undefined;
}
function filterUses(uses: string) {
    return (card: Card) => cardUses(card) === uses;
}


export function filterTraits(
    filterState: MultiselectFilter,
    checkCustomizableOptions?: boolean,
) {
    const filters: Filter[] = [];

    for (const key of filterState) {
        filters.push((card: Card) => {
            const hasTrait = !!card.real_traits?.includes(key);

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

    return or(filters);
}

export function makeOptionFilter(
    option: DeckOption,
    config?: InvestigatorAccessConfig,
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
                !config?.ignoreUnselectedCustomizableOptions,
            ),
        );
    }

    if (option.uses) {
        filterCount += 1;

        const usesFilters: Filter[] = [];

        for (const uses of option.uses) {
            usesFilters.push(filterUses(uses));
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
                optionSelectFilters.push(filterTraits(select.trait.map(capitalize)));
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

        optionFilter.push(
            filterTag("se", !config?.ignoreUnselectedCustomizableOptions),
        );
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

export function filterInvestigatorAccess(
    investigator: Card,
    config?: InvestigatorAccessConfig,
): Filter | undefined {
    const mode = config?.targetDeck ?? "slots";

    const deckFilter =
        mode !== "extraSlots"
            ? makePlayerCardsFilter(
                investigator,
                "deck_options",
                "deck_requirements",
                config,
            )
            : undefined;

    const extraDeckFilter =
        mode !== "slots"
            ? makePlayerCardsFilter(
                investigator,
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

export function splitMultiValue(s?: string) {
    if (!s) return [];
    return s.split(".").reduce<string[]>((acc, curr) => {
        const s = curr.trim();
        if (s) acc.push(s);
        return acc;
    }, []);
}
export type MultiselectFilter = string[];

function filterRestrictions(card: Card, investigator: Card) {
    if (Array.isArray(card.restrictions?.trait)) {
        const targetTraits = card.restrictions.trait;
        return splitMultiValue(investigator.real_traits).some((t) =>
            targetTraits.includes(t.toLowerCase()),
        );
    }

    return true;
}

export function filterType(enabledTypeCodes: MultiselectFilter) {
    return (card: Card) => enabledTypeCodes.includes(card.type_code);
}

function makePlayerCardsFilter(
    investigator: Card,
    optionsAccessor: "deck_options" | "side_deck_options",
    requiredAccessor: "deck_requirements" | "side_deck_requirements",
    config?: InvestigatorAccessConfig,
) {
    let options = investigator[optionsAccessor];
    const requirements = investigator[requiredAccessor]?.card;

    if (!requirements || !options) {
        return undefined;
    }

    // normalize parallel investigators to root for lookups.
    const code = investigator.alternate_of_code ?? investigator.code;

    // special case: suzi's additional deck options allow any xp card.
    if (code === "89001") {
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
            filterRequired(investigator),
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
        const filter = makeOptionFilter(option, config);

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
            const filter = makeOptionFilter(option, config);
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

export function hasAccess(
    investigatorCode: string,
    card: Card,
) {
    const filter = filterInvestigatorAccess(
        card,
        {
            additionalDeckOptions: undefined,
            ignoreUnselectedCustomizableOptions: false,
            selections: undefined,
            targetDeck: "slots"
        }
    );
    return filter && filter(card);
}