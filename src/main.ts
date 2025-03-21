import { connectToDatabase } from './db';
import { runServer } from './server';
import { syncData } from './sync';
import dotenv from 'dotenv';

async function main() {
    dotenv.config();
    if (process.argv.length > 2) {
        const command = process.argv[2];
        if (command === 'sync') {
            const forceReindex = process.argv.includes('force-reindex');
            const db = await connectToDatabase();
            await syncData(forceReindex, db);
        }
        else if (command === 'serve') {
            try {
                await runServer()
            } catch (error) {
                console.error(`Error running server: ${error}`);
            }
        }
        else if (command === 'clear-cache') {
            const db = await connectToDatabase();
            await db.none('TRUNCATE recommendation_cache');
            console.log('Cache cleared');
        }
        else {
            console.error('Invalid command, expected "sync" or "serve"');
        }
    }
    else {
        console.error('No command provided, expected "sync" or "serve"');
    }
}

main();