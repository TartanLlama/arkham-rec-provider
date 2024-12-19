import pgPromise, { IMain } from "pg-promise";

export const pgp: IMain = pgPromise({ "capSQL": true });
export async function connectToDatabase() {
    const conn = pgp({
        host: 'localhost',
        user: 'postgres',
        password: 'yENwvP!Xj*G^S0L50##M%',
        database: 'arkham'
    });
    return conn;
}