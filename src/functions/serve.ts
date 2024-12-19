import { app } from "@azure/functions";
import { handleRequest } from "../server";
import { connectToDatabase } from "../db";
import { RecommendationRequest } from "../index.types";

app.http('serve', {
    methods: ['POST'],
    handler: async (request, context) => {
        const conn = await connectToDatabase();
        try {
            const reqData = (await request.json()) as RecommendationRequest;
            const response = await handleRequest(conn, reqData);
            return {
                status: 200,
                body: JSON.stringify(response),
            };
        } catch (error) {
            console.error(`Error getting recommendations: ${error}:${context}`);
            return {
                status: 500,
                body: JSON.stringify({
                    status: 500,
                    error,
                }),
            };
        }
    },
});