import pgPromise, { IMain } from "pg-promise";
import dotenv from 'dotenv';

dotenv.config();

export const pgp: IMain = pgPromise({ "capSQL": true });
export async function connectToDatabase() {
    const conn = pgp({
        host: process.env.RECDB_HOST,
        user: process.env.RECDB_USER,
        password: process.env.RECDB_PASS,
        database: process.env.RECDB_NAME,
    });
    return conn;
}