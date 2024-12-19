import helmet from 'helmet';
import express from 'express';
import cors from 'cors';
import { connectToDatabase, pgp } from "./db";
import { RecommendationApiResponse, RecommendationRequest } from './index.types';
import { getRecommendations } from './recommendations';
import { IDatabase } from 'pg-promise';

export function validateRecommendationRequest(reqData: RecommendationRequest): string | null {
    if (!reqData.canonical_investigator_code || typeof reqData.canonical_investigator_code !== 'string') {
        return 'Invalid investigator_code';
    }
    if (!Array.isArray(reqData.required_cards)) {
        return 'Invalid required_cards';
    }
    if (!Array.isArray(reqData.cards_to_recommend)) {
        return 'Invalid cards_to_recommend';
    }
    if (!reqData.date_range || !Array.isArray(reqData.date_range) || reqData.date_range.length !== 2) {
        return 'Invalid date_range';
    }
    return null;
}

export async function handleRequest(db: IDatabase<{}>, reqData: RecommendationRequest): Promise<RecommendationApiResponse> {
    const validationError = validateRecommendationRequest(reqData);
    if (validationError) {
        throw new Error(validationError);
    }

    const nDecks = await db.query(`SELECT COUNT(*) as deck_count FROM decklists`);
    const recommendations = await getRecommendations(
        reqData,
        db,
        pgp
    );
    const response: RecommendationApiResponse = {
        data: {
            recommendations: {
                decks_analyzed: nDecks[0].deck_count,
                recommendations: recommendations
            }
        }
    };
    return response;
}

export async function runServer(port: number) {
    const conn = await connectToDatabase();
    const app = express();
    app.use(helmet());
    app.use(express.json({ limit: '10kb' }));
    app.use(cors());

    app.options('*', cors());

    app.post('/api/serve', async (req, res) => {
        try {
            const recs = await handleRequest(conn, req.body);
            res.status(200).json(recs);
        } catch (error) {
            console.error(`Error getting recommendations: ${error}`);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.use((req, res) => {
        res.status(404).send('404 Not Found');
    });

    app.listen(port, () => {
        console.log(`Server running at port ${port}`);
    });
}
