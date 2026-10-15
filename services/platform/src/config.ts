import { EnvMissingError, type ReporterOptions } from 'envalid';

/**
 * envalid reporter that throws one error naming every missing or invalid setting,
 * instead of envalid's default of printing and exiting. The caller decides how to fail.
 *
 *   cleanEnv(env, spec, { reporter: configReporter('gateway') })
 */
export const configReporter = (service: string) =>
    <T>({ errors }: ReporterOptions<T>): void => {
        const problems = Object.entries(errors).map(([name, error]) =>
            `${name} (${error instanceof EnvMissingError ? 'missing' : (error as Error).message})`);
        if (problems.length) {
            throw new Error(`Invalid ${service} configuration: ${problems.join(', ')}`);
        }
    };
