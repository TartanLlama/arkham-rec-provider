import pgPromise, { IMain } from "pg-promise";

export const pgp: IMain = pgPromise({ "capSQL": true });
export async function connectToDatabase() {
    const conn = pgp({
        host: process.env.RECDB_HOST,
        user: process.env.RECDB_USER,
        password: process.env.RECDB_PASS,
        database: process.env.RECDB_NAME,
        ssl: process.env.NODE_ENV !== 'development'
    });
    return conn;
}