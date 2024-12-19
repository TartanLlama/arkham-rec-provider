import { runServer } from './server';
import { syncData } from './sync';


async function main() {
    if (process.argv.length > 2) {
        const command = process.argv[2];
        if (command === 'sync') {
            const forceReindex = process.argv.includes('force-reindex');
            await syncData(forceReindex);
        }
        else if (command === 'serve') {
            const port = parseInt(process.argv[3] || '9191');
            try {
                await runServer(port)
            } catch (error) {
                console.error(`Error running server: ${error}`);
            }
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