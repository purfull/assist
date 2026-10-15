import path from 'path';
import { DataTypes, QueryTypes, type QueryInterface, type Sequelize } from 'sequelize';
import { Umzug, SequelizeStorage, type MigrationMeta, type RunnableMigration } from 'umzug';
import type { Logger } from 'pino';

/**
 * Schema migrations with Umzug.
 *
 * Each service keeps its own migrations folder and its own bookkeeping table
 * (e.g. migrations_auth), since services share one MySQL instance but own different tables.
 *
 * Migration files export `up` and `down`, receiving { context: { queryInterface, DataTypes } }:
 *
 *   import type { Migration } from '@ai-search/platform';
 *   export const up: Migration = async ({ context: { queryInterface, DataTypes } }) => { ... };
 */

export interface MigrationContext {
    queryInterface: QueryInterface;
    DataTypes: typeof DataTypes;
}

export type Migration = (params: { context: MigrationContext }) => Promise<void>;

interface MigrationModule {
    up: Migration;
    down: Migration;
}

export interface MigratorOptions {
    sequelize: Sequelize;
    /** Directory holding the migration files (compiled .js, or .ts under tsx) */
    dir: string;
    /** Bookkeeping table, one per service, e.g. migrations_auth */
    tableName: string;
    logger: Logger;
}

// Names are recorded with a .js extension whether the file ran from src (.ts, via tsx)
// or dist (.js), so development and production agree on what has been applied.
const normaliseName = (name: string): string => name.replace(/\.ts$/, '.js');

export const createMigrator = ({ sequelize, dir, tableName, logger }: MigratorOptions): Umzug<MigrationContext> =>
    new Umzug<MigrationContext>({
        migrations: {
            glob: ['*.{js,ts}', { cwd: dir, ignore: ['*.d.ts'] }],
            resolve: ({ name, path: filePath }): RunnableMigration<MigrationContext> => {
                if (!filePath) throw new Error(`Migration ${name} has no path`);
                // Loaded on demand by path (.js in dist, .ts under tsx), so a dynamic require is intended
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const load = (): MigrationModule => require(path.resolve(filePath)) as MigrationModule;
                return {
                    name: normaliseName(name),
                    // Umzug passes the context when it runs the migration
                    up: async ({ context }) => load().up({ context }),
                    down: async ({ context }) => load().down({ context }),
                };
            },
        },
        context: { queryInterface: sequelize.getQueryInterface(), DataTypes },
        storage: new SequelizeStorage({ sequelize, tableName }),
        logger: {
            info: (event) => logger.info(event, 'migration'),
            warn: (event) => logger.warn(event, 'migration'),
            error: (event) => logger.error(event, 'migration'),
            debug: (event) => logger.debug(event, 'migration'),
        },
    });

/**
 * Apply pending migrations while holding a MySQL named lock, so several instances
 * starting at once (MIGRATE_ON_START) don't run the same migration twice.
 * The lock lives on one pinned connection for the whole run.
 */
export const migrateUp = async (
    options: MigratorOptions & { lockTimeoutSeconds?: number },
): Promise<MigrationMeta[]> => {
    const { sequelize, tableName, logger, lockTimeoutSeconds = 60 } = options;
    const migrator = createMigrator(options);
    const lockName = `${sequelize.getDatabaseName()}.${tableName}`;

    return sequelize.transaction(async (transaction) => {
        const rows = await sequelize.query<{ acquired: number | null }>(
            'SELECT GET_LOCK(:lockName, :timeout) AS acquired',
            { replacements: { lockName, timeout: lockTimeoutSeconds }, type: QueryTypes.SELECT, transaction },
        );
        if (rows[0]?.acquired !== 1) {
            throw new Error(`Could not acquire migration lock "${lockName}" within ${lockTimeoutSeconds}s`);
        }
        try {
            const applied = await migrator.up();
            logger.info({ applied: applied.map((m) => m.name) }, 'Migrations up to date');
            return applied;
        } finally {
            await sequelize.query('SELECT RELEASE_LOCK(:lockName)', {
                replacements: { lockName },
                type: QueryTypes.SELECT,
                transaction,
            });
        }
    });
};

/**
 * Tiny CLI: migrate [up|down|pending|executed]
 */
export const runMigrationCli = async (
    options: MigratorOptions,
    command: string = process.argv[2] ?? 'up',
): Promise<void> => {
    const { sequelize, logger } = options;
    try {
        if (command === 'up') {
            await migrateUp(options);
        } else {
            const migrator = createMigrator(options);
            if (command === 'down') {
                const reverted = await migrator.down();
                logger.info({ reverted: reverted.map((m) => m.name) }, 'Reverted last migration');
            } else if (command === 'pending' || command === 'executed') {
                const list = command === 'pending' ? await migrator.pending() : await migrator.executed();
                // Plain output for humans running the CLI
                process.stdout.write(`${list.map((m) => m.name).join('\n') || `(no ${command} migrations)`}\n`);
            } else {
                throw new Error(`Unknown command "${command}". Use up | down | pending | executed.`);
            }
        }
        await sequelize.close();
    } catch (err) {
        logger.fatal({ err }, 'Migration command failed');
        await sequelize.close().catch(() => undefined);
        process.exit(1);
    }
};
