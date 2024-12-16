import fs from 'node:fs';
import http from 'node:http';
import { CardInclusions, Decklists, DecksByInvestigator, InvestigatorCounts, InvestigatorNames } from './recommendations.types';
import { RecommendationRequest, RecommendationApiResponse, Index } from './index.types';
import { Card, Deck, Id } from './stolen.types';
import { dateToMonth, getRecommendations } from './recommendations';
import { initAccessChecking } from './access_checking';

function indexById<T extends { id: string | Id }>(data: T[]) {
    return data.reduce((acc: Record<string, T>, item) => {
        acc[item.id] = item;
        return acc;
    }, {});
}

function indexData(decklists: Deck[], cards: Card[]) {
    const deckInclusions: CardInclusions = {};
    const sideDeckInclusions: CardInclusions = {};
    const deckInvestigatorCounts: InvestigatorCounts = {};
    const decksByInvestigator: DecksByInvestigator = {};
    for (const deck of decklists) {
        if (!deck.slots) {
            continue
        }
        const month = dateToMonth(new Date(deck.date_creation));
        for (const slot of Object.keys(deck.slots)) {
            deckInclusions[slot] ??= [];
            deckInclusions[slot].push(deck.id);

            deckInvestigatorCounts[deck.investigator_code] ??= {};
            deckInvestigatorCounts[deck.investigator_code][month] ??= {};
            deckInvestigatorCounts[deck.investigator_code][month][slot] ??= [0, 0];
            deckInvestigatorCounts[deck.investigator_code][month][slot][0] += +!!deck.slots[slot];
            deckInvestigatorCounts[deck.investigator_code][month][slot][1] += +!!deck.slots[slot];
        }
        if (!Array.isArray(deck.sideSlots)) {
            for (const slot of Object.keys(deck.sideSlots)) {
                // Don't overcount cards that are in both main and side deck
                if (!deck.slots[slot]) {
                    sideDeckInclusions[slot] ??= [];
                    sideDeckInclusions[slot].push(deck.id);

                    deckInvestigatorCounts[deck.investigator_code] ??= {};
                    deckInvestigatorCounts[deck.investigator_code][month] ??= {};
                    deckInvestigatorCounts[deck.investigator_code][month][slot] ??= [0, 0];
                    deckInvestigatorCounts[deck.investigator_code][month][slot][1] += +!!deck.sideSlots[slot];
                }
            }
        }

        decksByInvestigator[deck.investigator_code] ??= {};
        decksByInvestigator[deck.investigator_code][month] ??= {};
        decksByInvestigator[deck.investigator_code][month][deck.id] = 1;
    }
    const investigatorNames = cards.filter((card) => card.type_code === 'investigator').reduce<InvestigatorNames>((acc, card) => {
        acc[card.code] = card.real_name;
        return acc;
    }, {});
    const index: Index = {
        deckInclusions,
        sideDeckInclusions,
        deckInvestigatorCounts,
        decksByInvestigator,
        investigatorNames,
    };
    fs.writeFileSync('data/index.json', JSON.stringify(index));
}

async function syncDecklists() {
    let decklists: Deck[] = [];

    //Only get the last 1000 days of data for now
    for (let i = 0; i < 1000; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateString = date.toISOString().split('T')[0];
        const url = `https://arkhamdb.com/api/public/decklists/by_date/${dateString}`;
        const response = await fetch(url);
        const data = (await response.json()) as Deck[];
        decklists = decklists.concat(data);
    }
    fs.writeFileSync('data/decklists.json', JSON.stringify(decklists));
}

async function syncCards() {
    const response = await fetch('https://api.arkham.build/v1/cache/cards');
    const data = await response.json() as any;
    const unpacked = data.data.all_card;
    fs.writeFileSync('data/cards.json', JSON.stringify(unpacked));
}

async function getData(): Promise<[Decklists, Index]> {
    if (!fs.existsSync('data/decklists.json')) {
        console.log('Data not found, fetching...');
        await syncDecklists();
    }
    if (!fs.existsSync('data/cards.json')) {
        console.log('Cards not found, fetching...');
        await syncCards();
    }
    const decklistData = JSON.parse(fs.readFileSync('data/decklists.json', 'utf-8'));
    const cardsData = JSON.parse(fs.readFileSync('data/cards.json', 'utf-8'));
    initAccessChecking(cardsData);
    if (!fs.existsSync('data/index.json')) {
        indexData(decklistData, cardsData);
    }
    const decklists: Decklists = indexById(decklistData);
    const index: Index = JSON.parse(fs.readFileSync('data/index.json', 'utf-8'));

    return [decklists, index];
}

async function main() {
    const [decklists, indexData] = await getData();

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
            req.on('end', () => {
                const reqData = JSON.parse(body) as RecommendationRequest;
                const recommendations = getRecommendations(
                    reqData,
                    decklists,
                    indexData
                );
                const response: RecommendationApiResponse = {
                    data: {
                        recommendations: {
                            decks_analyzed: Object.keys(decklists).length,
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

