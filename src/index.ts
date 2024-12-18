import fs from 'node:fs';
import http from 'node:http';
import { CardInclusions, Decklists, DecksByInvestigator, InvestigatorCounts, InvestigatorNames } from './recommendations.types';
import { RecommendationRequest, RecommendationApiResponse, Index } from './index.types';
import { Card, Deck, Id } from './stolen.types';
import { dateToMonth, getRecommendations } from './recommendations';
import pgPromise from 'pg-promise';
import { ColumnSet, IDatabase, IMain } from 'pg-promise';
import { resolve } from 'node:path';

const pgp: IMain = pgPromise({ "capSQL": true });

async function initDecklistsTables(db: IDatabase<{}>) {
    await db.tx((t) => {
        const queries = [
            `CREATE TABLE IF NOT EXISTS decklists(
                id VARCHAR(128) PRIMARY KEY,
                name TEXT,
                date_creation DATE,
                date_update DATE,
                description_md TEXT,
                investigator_code CHAR(6),
                investigator_name TEXT,
                source TEXT,
                taboo_id INT,
                slots JSONB,
                side_slots JSONB
            );`,

            `CREATE INDEX IF NOT EXISTS idx_decklists_date_creation ON decklists USING btree (date_creation)`,
            `CREATE INDEX IF NOT EXISTS idx_decklists_investigator_code ON decklists USING btree (investigator_code)`,
            `CREATE INDEX IF NOT EXISTS idx_decklists_investigator_code_date_creation ON decklists USING btree (investigator_code, date_creation)`,
            `CREATE INDEX IF NOT EXISTS idx_decklists_side_slots_gin ON decklists USING gin (side_slots jsonb_path_ops)`,
            `CREATE INDEX IF NOT EXISTS idx_decklists_slots_gin ON decklists USING gin (slots jsonb_path_ops)`,

            `CREATE TABLE IF NOT EXISTS decklist_ingest_dates (
            ingest_date DATE PRIMARY KEY)`
        ];
        return t.batch(queries.map((query) => t.none(query)));
    }).catch(error => {
        console.error(`Error creating tables: ${error}`);
    });
    //TODO meta?
}

function formatDateForMariaDB(dateString: string): string {
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
    'investigator_code',
    'investigator_name',
    'source',
    'taboo_id',
    'slots',
    'side_slots'
], { table: 'decklists' });

const ingestColumns = new pgp.helpers.ColumnSet(['ingest_date'],
    { table: 'decklist_ingest_dates' });

async function insertDataForDate(date: Date, db: IDatabase<{}>) {
    const dateString = date.toISOString().split('T')[0];
    const url = `https://arkhamdb.com/api/public/decklists/by_date/${dateString}`;
    const response = await fetch(url);
    const data = (await response.json()) as Deck[] | ServerError;
    if (isServerError(data)) {
        console.error(`Error fetching data for ${date}: ${data.error.message}`);
        return;
    }

    const decklistData = data.map((deck) => {
        return {
            id: deck.id,
            name: deck.name,
            date_creation: formatDateForMariaDB(deck.date_creation),
            date_update: formatDateForMariaDB(deck.date_update),
            description_md: deck.description_md,
            investigator_code: deck.investigator_code,
            investigator_name: deck.investigator_name,
            source: deck.source,
            taboo_id: deck.taboo_id,
            slots: deck.slots,
            side_slots: Array.isArray(deck.sideSlots) ? {} : deck.sideSlots,
        };
    });

    await db.tx((t) => {
        const queries = [];
        if (decklistData.length) {
            queries.push(pgp.helpers.insert(decklistData, decklistColumns));
        }

        queries.push(pgp.helpers.insert({ ingest_date: date }, ingestColumns));

        return t.batch(queries.map((query) => t.none(query)));
    }).catch(error => {
        console.error(`Error ingesting data for ${date}: ${error}`);
        console.error(url);
    });
}

async function buildCardCountIndexes(db: IDatabase<{}>) {
    const queries = [
        `CREATE TABLE IF NOT EXISTS card_inclusion_counts (
            investigator_code CHAR(6),
            card_code CHAR(6),
            creation_month DATE,
            deck_count_with_card INT,
            PRIMARY KEY (investigator_code, card_code, creation_month)
        )`,

        `CREATE TABLE IF NOT EXISTS investigator_deck_counts (
            investigator_code CHAR(6),
            creation_month DATE,
            deck_count INT,
            PRIMARY KEY (investigator_code, creation_month)
        )`,

        'DELETE FROM card_inclusion_counts',

        'DELETE FROM investigator_deck_counts',

        `INSERT INTO investigator_deck_counts (investigator_code, creation_month, deck_count)
        SELECT d.investigator_code,
               date_trunc('month', d.date_creation) AS creation_month,
               COUNT(DISTINCT d.id) AS deck_count
        FROM decklists d
        GROUP BY d.investigator_code, creation_month`,

        `INSERT INTO card_inclusion_counts (investigator_code, card_code, creation_month, deck_count_with_card)
        SELECT d.investigator_code,
               c.code AS card_code,
               date_trunc('month', d.date_creation) AS creation_month,
               COUNT(DISTINCT d.id) AS deck_count_with_card
        FROM decklists d
        JOIN cards c ON d.slots ? c.code OR d.side_slots ? c.code
        GROUP BY d.investigator_code, c.code, creation_month`
    ];
    await db.tx((t) => {
        return t.batch(queries.map((query) => t.none(query)));
    }).catch(error => {
        console.error(`Error building card count indexes: ${error}`);
    });
}

async function syncDecklists(db: IDatabase<{}>) {
    await initDecklistsTables(db);

    let date = new Date();
    //Don't get data from today because it may not be complete
    //Also don't get data from yesterday because I don't trust timezones
    date.setDate(date.getDate() - 2);
    //Get the start of the day in UTC
    date.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(2016, 9, 2); //First decklists were uploaded on this date
    let haveIngested = false;
    for (; date >= endDate; date.setDate(date.getDate() - 1)) {
        const haveIngestedResult = await db.query('SELECT * FROM decklist_ingest_dates WHERE ingest_date = $1', [date]);
        if (haveIngestedResult.length) {
            break;
        }
        await insertDataForDate(date, db);
        haveIngested = true;
    }

    if (haveIngested) {
        await buildCardCountIndexes(db);
    }
}

async function initCardsTable(db: IDatabase<{}>) {
    await db.none(
        `CREATE TABLE IF NOT EXISTS cards (
            code CHAR(6) PRIMARY KEY, 
            name TEXT);`);
}

const cardColumns = new pgp.helpers.ColumnSet(['code', 'name'], { table: 'cards' });

async function syncCards(db: IDatabase<{}>) {
    await initCardsTable(db);

    const response = await fetch('https://api.arkham.build/v1/cache/cards');
    const data = await response.json() as any;
    const cardData = Array.from(
        new Map(
            data.data.all_card
                .map((card: Card) => [card.code, { code: card.code, name: card.real_name }])
        ).values()
    );
    await db.tx((t) => {
        return t.none(pgp.helpers.insert(cardData, cardColumns));
    }).catch(error => {
        console.error(`Error inserting cards: ${error}`);
    });
}

async function tableExists(db: IDatabase<{}>, tableName: string) {
    const result = await db.query(
        `SELECT EXISTS (SELECT *
            FROM information_schema.tables
            WHERE table_name = $1 
              AND table_schema = 'public') AS table_exists`, [tableName]);
    return result[0].table_exists;
}

async function syncData(db: IDatabase<{}>) {
    await syncDecklists(db);
    if (!await tableExists(db, 'cards')) {
        console.log('Cards not found, fetching...');
        await syncCards(db);
    }
}

async function connectToDatabase() {
    const conn = pgp({
        host: 'localhost',
        user: 'postgres',
        password: 'yENwvP!Xj*G^S0L50##M%',
        database: 'arkham'
    });
    return conn;
}

async function main() {
    const conn = await connectToDatabase();
    await syncData(conn);

    const server = http.createServer((req, res) => {
        if (req.url === '/recommendations') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
            res.writeHead(200, { 'Content-Type': 'application/json' });
            if (req.headers['access-control-request-method'] === 'POST') {
                res.end();
                return;
            }

            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', async () => {
                const nDecks = await conn.query(`SELECT COUNT(*) as deck_count FROM decklists`);
                const reqData = JSON.parse(body) as RecommendationRequest;
                const recommendations = await getRecommendations(
                    reqData,
                    (query: string, values?: any) => conn.query(query, values),
                );
                const response: RecommendationApiResponse = {
                    data: {
                        recommendations: {
                            decks_analyzed: nDecks[0].deck_count,
                            recommendations: recommendations
                        }
                    }
                };
                res.write(JSON.stringify(response));
                res.end();
            });
        }
        else {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.write('404 Not Found');
            res.end();
        }
    });

    server.listen(9191, () => {
        console.log('Server running at http://localhost:9191/');
    });
}

main();