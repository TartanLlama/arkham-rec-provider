import { IDatabase, ITask } from "pg-promise";
import { connectToDatabase, pgp } from "./db";
import { Card, Deck, DeckMeta } from "./stolen.types";

async function initDecklistsTables(t: ITask<{}>) {
    const queries = [
        `CREATE TABLE IF NOT EXISTS decklists(
                id VARCHAR(128) PRIMARY KEY,
                name TEXT,
                date_creation DATE,
                date_update DATE,
                description_md TEXT,
                investigator_code VARCHAR(6),
                investigator_name TEXT,
                meta JSONB,
                source TEXT,
                taboo_id INT,
                slots JSONB,
                side_slots JSONB,
                canonical_investigator_code VARCHAR(13)
            )`,

        `CREATE INDEX IF NOT EXISTS idx_decklists_date_creation ON decklists USING btree (date_creation)`,
        `CREATE INDEX IF NOT EXISTS idx_decklists_canonical_investigator_code ON decklists USING btree (canonical_investigator_code)`,
        `CREATE INDEX IF NOT EXISTS idx_decklists_canonical_investigator_code_date_creation ON decklists USING btree (canonical_investigator_code, date_creation)`,
        `CREATE INDEX IF NOT EXISTS idx_decklists_side_slots_gin ON decklists USING gin (side_slots jsonb_path_ops)`,
        `CREATE INDEX IF NOT EXISTS idx_decklists_slots_gin ON decklists USING gin (slots jsonb_path_ops)`,

        `CREATE TABLE IF NOT EXISTS decklist_ingest_dates (
            ingest_date DATE PRIMARY KEY)`,

        `CREATE TABLE IF NOT EXISTS decklist_slots (
                decklist_id VARCHAR(128) REFERENCES decklists(id) ON DELETE CASCADE,
                card_code VARCHAR(6),
                count INT
            )`,
        `CREATE TABLE IF NOT EXISTS decklist_side_slots (
                decklist_id VARCHAR(128) REFERENCES decklists(id) ON DELETE CASCADE,
                card_code VARCHAR(6),
                count INT
            )`
    ];
    await t.batch(queries.map((query) => t.none(query)));
}

function formatDateForDB(dateString: string): string {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

type ServerError = {
    error: {
        code: number;
        message: string;
    }
};

function isServerError(data: any): data is ServerError {
    return (data as ServerError).error !== undefined;
}

const decklistColumns = new pgp.helpers.ColumnSet([
    'id',
    'name',
    'date_creation',
    'date_update',
    'description_md',
    'meta',
    'investigator_code',
    'investigator_name',
    'source',
    'taboo_id',
    'slots',
    'side_slots',
    'canonical_investigator_code'
], { table: 'decklists' });

const decklistSlotsColumns = new pgp.helpers.ColumnSet([
    'decklist_id',
    'card_code',
    'count'
], { table: 'decklist_slots' });

const decklistSideSlotsColumns = new pgp.helpers.ColumnSet([
    'decklist_id',
    'card_code',
    'count'
], { table: 'decklist_side_slots' });

const ingestColumns = new pgp.helpers.ColumnSet(['ingest_date'],
    { table: 'decklist_ingest_dates' });


function decodeDeckMeta(deck: Deck): DeckMeta {
    try {
        const metaJson = JSON.parse(deck.meta);
        const obj = typeof metaJson === "object" && metaJson != null ? metaJson : {};
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string' && value === '') {
                delete obj[key];
            }
        }
        return obj;
    } catch {
        return {};
    }
}

async function generateDeduplicationMap(t: ITask<{}>): Promise<Map<string, string>> {
    const duplicates = await t.many('SELECT code, duplicate_of_code FROM cards WHERE duplicate_of_code IS NOT NULL');
    const deduplicationMap = new Map<string, string>();
    for (const { code, duplicate_of_code } of duplicates) {
        deduplicationMap.set(code, duplicate_of_code);
    }
    return deduplicationMap;
}

function canonicalizeDeck(deck: Deck, deduplicationMap: Map<string, string>): any {
    if (deduplicationMap.has(deck.investigator_code)) {
        deck.investigator_code = deduplicationMap.get(deck.investigator_code) as string;
    }
    for (const [code, count] of Object.entries(deck.slots)) {
        if (deduplicationMap.has(code)) {
            deck.slots[deduplicationMap.get(code) as string] = count;
            delete deck.slots[code];
        }
    }
    if (Array.isArray(deck.sideSlots)) {
        deck.sideSlots = {};
    }
    else {
        for (const [code, count] of Object.entries(deck.sideSlots)) {
            if (deduplicationMap.has(code)) {
                deck.sideSlots[deduplicationMap.get(code) as string] = count;
                delete deck.sideSlots[code];
            }
        }
    }

    const meta = decodeDeckMeta(deck);
    let frontCode = meta.alternate_front ?? deck.investigator_code;
    let backCode = meta.alternate_back ?? deck.investigator_code;
    if (deduplicationMap.has(frontCode)) {
        frontCode = deduplicationMap.get(frontCode) as string;
    }
    if (deduplicationMap.has(backCode)) {
        backCode = deduplicationMap.get(backCode) as string;
    }
    return {
        id: deck.id,
        name: deck.name,
        description_md: deck.description_md,
        investigator_name: deck.investigator_name,
        investigator_code: deck.investigator_code,
        slots: deck.slots,
        side_slots: deck.sideSlots,
        taboo_id: deck.taboo_id,
        source: deck.source,
        date_creation: formatDateForDB(deck.date_creation),
        date_update: formatDateForDB(deck.date_update),
        meta: JSON.stringify(meta),
        canonical_investigator_code: `${frontCode}-${backCode}`
    };
}

async function insertDataForDate(date: Date, t: ITask<{}>, deduplicationMap: Map<string, string>) {
    const dateString = date.toISOString().split('T')[0];
    const url = `https://arkhamdb.com/api/public/decklists/by_date/${dateString}`;
    const response = await fetch(url);
    const data = (await response.json()) as Deck[] | ServerError;
    if (isServerError(data)) {
        console.error(`Error fetching data for ${date}: ${data.error.message}`);
        return;
    }

    const decklistData = data.map((d) => {
        return canonicalizeDeck(d, deduplicationMap);
    });

    const slotsData = data.flatMap((deck) => {
        return Object.entries(deck.slots).map(([cardCode, count]) => {
            return {
                decklist_id: deck.id,
                card_code: cardCode,
                count: count
            };
        });
    });
    const sideSlotsData = data.flatMap((deck) => {
        return Array.isArray(deck.sideSlots) ?
            [] :
            Object.entries(deck.sideSlots).map(([cardCode, count]) => {
                return {
                    decklist_id: deck.id,
                    card_code: cardCode,
                    count: count
                };
            });
    });

    const queries = [];
    if (decklistData.length) {
        queries.push(pgp.helpers.insert(decklistData, decklistColumns));
    }

    if (slotsData.length) {
        queries.push(pgp.helpers.insert(slotsData, decklistSlotsColumns));
    }

    if (sideSlotsData.length) {
        queries.push(pgp.helpers.insert(sideSlotsData, decklistSideSlotsColumns));
    }

    queries.push(pgp.helpers.insert({ ingest_date: date }, ingestColumns));

    await t.batch(queries.map((query) => t.none(query)));
}

async function buildCardCountIndexes(t: ITask<{}>) {
    await t.none(`CREATE TABLE IF NOT EXISTS card_inclusion_counts (
            canonical_investigator_code VARCHAR(13),
            card_code VARCHAR(6),
            creation_month DATE,
            deck_count_with_card INT,
            PRIMARY KEY (canonical_investigator_code, card_code, creation_month)
        )`);
    await t.none(`CREATE INDEX IF NOT EXISTS idx_card_inclusion_counts_canonical_investigator_code_creation_month_card_code ON card_inclusion_counts(canonical_investigator_code, creation_month, card_code);`);

    await t.none(`CREATE TABLE IF NOT EXISTS investigator_deck_counts (
            canonical_investigator_code VARCHAR(13),
            creation_month DATE,
            deck_count INT,
            PRIMARY KEY (canonical_investigator_code, creation_month)
        )`);
    await t.none(`CREATE INDEX IF NOT EXISTS idx_card_inclusion_counts_canonical_investigator_code_creation_month_card_code ON card_inclusion_counts(canonical_investigator_code, creation_month, card_code);`);

    await t.none('TRUNCATE TABLE card_inclusion_counts, investigator_deck_counts RESTART IDENTITY CASCADE');

    await t.none(`INSERT INTO investigator_deck_counts (canonical_investigator_code, creation_month, deck_count)
        SELECT d.canonical_investigator_code,
               date_trunc('month', d.date_creation) AS creation_month,
               COUNT(DISTINCT d.id) AS deck_count
        FROM decklists d
        GROUP BY d.canonical_investigator_code, creation_month`);

    await t.none(
        `INSERT INTO card_inclusion_counts (canonical_investigator_code, card_code, creation_month, deck_count_with_card)
        SELECT d.canonical_investigator_code,
               c.code AS card_code,
               date_trunc('month', d.date_creation) AS creation_month,
               COUNT(DISTINCT d.id) AS deck_count_with_card
        FROM decklists d
        JOIN cards c ON d.slots ? c.code OR d.side_slots ? c.code
        GROUP BY d.canonical_investigator_code, c.code, creation_month`
    );
}

async function syncDecklists(db: ITask<{}>): Promise<boolean> {
    await initDecklistsTables(db);
    const deduplicationMap = await generateDeduplicationMap(db);

    let date = new Date();
    //Don't get data from today because it may not be complete
    //Also don't get data from yesterday because I don't trust timezones
    date.setUTCDate(date.getUTCDate() - 2);
    //Get the start of the day in UTC
    date.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(Date.UTC(2016, 9, 2)); //First decklists were uploaded on this date
    let haveIngested = false;
    for (; date >= endDate; date.setUTCDate(date.getUTCDate() - 1)) {
        const haveIngestedResult = await db.query('SELECT * FROM decklist_ingest_dates WHERE ingest_date = $1', [date]);
        if (haveIngestedResult.length) {
            break;
        }
        await insertDataForDate(date, db, deduplicationMap);
        haveIngested = true;
    }

    return haveIngested;
}

const cardColumns = new pgp.helpers.ColumnSet(['code', 'real_name', 'duplicate_of_code'], { table: 'cards' });

async function syncCards(t: ITask<{}>) {
    const response = await fetch('https://api.arkham.build/v1/cache/cards');
    const data = await response.json() as any;
    const cardData = Array.from(
        new Map(
            data.data.all_card
                .map((card: Card) => [card.code, { code: card.code, real_name: card.real_name, duplicate_of_code: card.duplicate_of_code }])
        ).values()
    );
    return t.none(pgp.helpers.insert(cardData, cardColumns));
}

export async function syncData(forceReindex: boolean, db: IDatabase<{}>) {
    db.tx(async (t) => {
        await db.none(
            `CREATE TABLE IF NOT EXISTS cards (
                code VARCHAR(6) PRIMARY KEY, 
                real_name TEXT,
                duplicate_of_code VARCHAR(6) NULL
            )`);

        const cardCount = await t.one('SELECT COUNT(*) FROM cards');
        await t.none('TRUNCATE TABLE cards RESTART IDENTITY CASCADE');
        console.log(`Found ${cardCount.count} cards in the database`);
        await syncCards(t);
        const newCardCount = await t.one('SELECT COUNT(*) FROM cards');
        console.log(`Added ${newCardCount.count - cardCount.count} new cards to the database`);

        const newCards = cardCount.count !== newCardCount.count;
        if (newCards) {
            console.log('New cards ingested, reindex needed');
        }

        console.log('Syncing decklists...');
        const newDecks = await syncDecklists(t);

        if (newDecks) {
            console.log('New data ingested, reindex needed');
        }

        if (forceReindex) {
            console.log('Reindex forced');
        }

        if (newDecks || newCards || forceReindex) {
            console.log('Building card count indexes...');
            await buildCardCountIndexes(t);
        }

        console.log('Sync complete');
    }).catch(error => {
        console.error(`Error syncing data: ${error}`);
    });
}
